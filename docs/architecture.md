# Arihant Workspace - System Architecture

> Source: architecture review approved on 2026-11-06. Update this document as the implementation evolves.

## 5. System architecture

```
 Browser (React SPA) ──HTTPS──► Nginx (TLS, static assets, gzip, rate-limit edge)
                                   │  /api/v1/*        │ /socket.io
                                   ▼                   ▼
                        API service (Express, N replicas, Socket.IO + Redis adapter)
                          │  modules: auth, org, projects, tasks, assignment, worklogs, ...
                          │  domain events ──► BullMQ queues (Redis)
                          ▼                                 ▼
                    MongoDB replica set               Worker service (same codebase, `worker.ts`)
                    (transactions)                     - assignment batches, automations,
                          ▲                             scheduled scanners, emails, exports, AI jobs
                          └──────────── MinIO (documents, attachments, exports)
                                         SMTP relay (on-prem mail)   Claude API (outbound only)
```

- **Modular monolith:** one codebase and two entrypoints (`server.ts` for HTTP and sockets, `worker.ts` for queues). Modules talk to each other only through exported service interfaces and domain events, never by touching another module's models directly. That keeps later extraction into separate services possible.
- **Domain events:** each service emits events (for example `task.created`, `task.status_changed`) through an in-process event bus. Subscribers (activity feed, notifications, automation, sockets) push work to BullMQ, so a failure in one subscriber never fails the original request.
- **Monorepo improvement over the brief:** add `packages/shared` (Zod schemas, enums, API types) consumed by both client and server. This is what keeps frontend and backend contracts in step (rule 18). npm workspaces, with no Turborepo or Nx yet.

## 6. Frontend architecture

- Vite + React + TS, **Tailwind v4 + shadcn/ui** (Radix), Lucide, Framer Motion (micro-transitions only).
- **State:** TanStack Query holds all server state. Redux Toolkit holds UI and global client state only: auth session, theme, sidebar, command palette, active filters and the timer widget.
- **Layers:** `services/api/*` (axios instance with refresh-token interceptor and typed endpoint functions using shared Zod types), then `features/*/hooks` (query/mutation hooks), then `features/*/components` (presentational). Components never call axios.
- **Routing:** React Router with lazy routes. The route config carries `requiredPermission`, and the sidebar is generated from the same config, filtered by the user's permissions.
- **Forms:** React Hook Form + Zod resolver, reusing schemas from `packages/shared`.
- **Shared components:** DataTable (TanStack Table, server pagination, sorting, filters, column visibility, saved views), FilterBar, SearchInput, Pagination, Modal, Drawer, FormField set, StatusBadge, PriorityIcon, ChartCard, StatCard, ActivityTimeline, UserAvatar/AvatarGroup, EmptyState, ErrorState, Skeletons, ConfirmDialog, CommandPalette (cmdk), NotificationCenter.
- **Views:** Kanban uses dnd-kit with optimistic status mutation and rollback. Calendar uses FullCalendar (free daygrid/timegrid). The Timeline/Gantt is a **custom SVG/CSS-grid component**, because FullCalendar's timeline is a paid plugin and the free React Gantt libraries are weak. Charts use Recharts, with heatmaps built as custom grids.
- **Realtime:** a Socket.IO client in a provider. Server events invalidate TanStack Query keys rather than patching caches by hand.
- **Folders:** as in the brief, plus `features/*/{api,hooks,components,pages,types}`.

## 7. Backend architecture

```
server/src/
  config/        env (Zod-validated), db, redis, logger (Pino), storage, mail, ai
  core/          errors (AppError hierarchy), http (response envelope), events (bus),
                 auth (jwt, password), rbac (policy engine), audit, pagination, idgen, time
  middleware/    requestId, httpLogger, helmet, cors, rateLimit, authenticate,
                 authorize(perm), validate(zod), mongoSanitize, upload, errorHandler
  modules/<name>/  <name>.routes.ts  .controller.ts  .service.ts  .model.ts
                   .validator.ts  .types.ts  .events.ts  __tests__/
  jobs/          queues.ts, workers/*, schedulers (repeatable jobs)
  sockets/       io.ts (auth handshake, rooms: user:<id>, project:<id>, dept:<id>)
  app.ts  server.ts  worker.ts
```

- **Response envelope:** `{ success, data, meta?: {page, limit, total}, error?: {code, message, details, requestId} }`.
- **Errors:** typed `AppError` (400/401/403/404/409/422/429). The error handler hides stack traces in production.
- **Validation:** Zod on body, query and params, with schemas from `packages/shared`.
- **API docs:** OpenAPI generated from Zod (`@asteasolutions/zod-to-openapi`) and served by Swagger UI at `/api/docs` (outside production, or behind admin).
- **Logging:** Pino JSON with `requestId` and `userId`; the request ID is propagated into jobs.

## 12. Automation architecture

- **Rule** = `trigger` + `conditions` + `actions[]`.
  - Triggers are domain events (`task.created`, `task.status_changed`, `task.overdue`, `task.blocked_for`, `project.status_changed`, `timesheet.missing`, `approval.pending_for`, `user.unavailable`) or a cron schedule.
  - Conditions are a JSON tree (`all`/`any` of `{field, op, value}`), evaluated by a small whitelisted evaluator (no `eval`, no arbitrary code).
  - Actions come from a fixed catalogue: notify (user/role/assignee/PM/dept head), send email, set field, add comment, create task, start approval, trigger smart-assign, start assignment review.
- **Time-based triggers** come from repeatable BullMQ **scanner jobs** (every 15 min: overdue, blocked ≥ N h, approvals pending ≥ SLA; daily 18:00 IST: missing timesheets and journals). Scanners emit the events that rules subscribe to.
- **Execution:** event → `automation` queue → worker loads matching enabled rules → evaluates → runs actions → writes `automationRuns`. Failures retry 3× with exponential backoff and then go to a dead-letter state, visible in the UI.
- **Safety:** loop guard (an action-originated event carries a `depth`; the maximum is 3), per-rule rate limit, idempotency key `ruleId+eventId`.
- **Workflow Builder** (Phase 7): a visual editor (React Flow) that edits the same rule JSON and approval-workflow stages. The UI is new; the backend model stays the same.

## 13. Smart assignment algorithm

**Eligibility (hard filters, each with a skip reason):** user active; member of the project team (or the configured eligible pool); not on approved leave on the task's planned window (defaults to the next N working days); has every _mandatory_ required skill at or above the minimum level; remaining capacity ≥ task effort, unless `allowOverCapacity` is set; not already assignee (deduplication).

**Workload (effort-based, not ticket count):**
`load_e = Σ over open tasks (ToDo/InProgress/InReview/Testing/Blocked) of remaining effort`, where remaining = `max(estimated − actual, 0.25·estimated)` for in-progress tasks and the full estimate otherwise. Unestimated tasks default to a configurable 2 h.
`cap_e = weeklyCapacityHours × horizonWeeks × availableDays/workingDays` (leave and partial availability reduce capacity).

**Normalised factor scores (0..1):**

- W (workload, 35%) = `1 − min(load_e / cap_e, 1)`
- C (capacity, 25%) = `max(cap_e − load_e − effort_t, 0) / cap_e`
- S (skill, 20%) = mean over required skills of `min(level_e / requiredLevel, 1)`; 1 if none are required. Optional skills add weight.
- P (priority/complexity, 10%) = `1 − |complexity_t − proficiency_e| / 4` (for critical tickets the proficiency term is doubled, so critical work goes to the most proficient eligible person)
- A (availability, 10%) = `availableDays / horizonDays`

`score = Σ wᵢ·factorᵢ`. Weights are stored in `settings` and validated to sum to 1.
**Tie-break:** least-recently-assigned first, then lowest current ticket count, then user ID (deterministic).

**Batch (preview → approve → execute):**

1. Sort tickets by priority (critical first), then due date ascending, then effort descending (largest-first gives better balance).
2. For each ticket, score every eligible candidate against an **in-memory, running** load; assign to the best; add the effort to that candidate's load; record a skip reason if no candidate qualifies.
3. Persist an `assignmentPlan` (draft) with proposals, before/after workload per person, people over capacity and skipped tickets. The manager can edit individual rows, approve or reject.
4. Execution runs as a BullMQ job (`jobId = plan.idempotencyKey`, so a double click cannot run it twice). Each assignment runs `findOneAndUpdate({_id, assignmentVersion: v, assigneeId: null|expected}, {$set: assignee, $inc: version})` inside a transaction along with an `assignmentHistories` insert. Capacity is re-validated at execution time. Conflicts are reported, never overwritten.
5. A per-pool Redis lock (`assign:project:<id>`) serialises concurrent batch or auto-assign runs for the same pool, which prevents over-allocation.

Equal testers with equal tickets: the running load update makes the greedy pass alternate, so 100 tickets across 4 testers gives exactly 25 each (this becomes a test case).
**Reassignment on unavailability:** candidates are only the person's _unstarted_ tasks (ToDo/Backlog). The engine generates a plan that needs approval. In-progress and critical tasks are listed for manual decision and never moved automatically.
**Rebalancing:** flag a user when `load/cap > 1.1` while a peer is below 0.6. Propose moving unstarted tasks from most to least loaded until spread ≤ the threshold. Same plan and approval flow.
**Services:** `WorkloadCalculationService`, `SkillMatchingService`, `CapacityValidationService`, `SmartAssignmentService` (scoring and planning), `AssignmentHistoryService`, `WorkloadRebalancingService`. The scoring core is pure functions, so it can be unit-tested without a database.

## Implementation decisions recorded during Phase 1

These are changes from the approved architecture, each made for a concrete technical reason.

| Decision                                                        | Reason                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Vitest for server tests** (the brief listed Jest)             | The server is native ESM TypeScript. Jest needs experimental VM modules or a CommonJS build for that; Vitest runs it directly with a Jest-compatible API. One test runner across server, client and shared. Supertest and mongodb-memory-server are used as planned.                                         |
| **SeaweedFS replaces MinIO for development object storage**     | MinIO stopped publishing community images (`minio/minio` on Docker Hub returns "repository does not exist"; `quay.io/minio/minio` returns 401). SeaweedFS is Apache-2.0 and S3-compatible. The API uses only the standard S3 protocol (`@aws-sdk/client-s3`), so production can use any S3-compatible store. |
| **Redis published on host port 6380 in development**            | Another local project already binds 6379. Containers still use 6379 internally.                                                                                                                                                                                                                              |
| **`@tanstack/react-table` pinned to v8**                        | v9 ships a reworked, feature-plugin API. v8 is the long-stable release and covers server-side pagination and sorting. Re-evaluate later.                                                                                                                                                                     |
| **OpenAPI document maintained in `server/src/docs/openapi.ts`** | Each module registers its paths as it ships, so the docs never list endpoints that do not exist. Zod-derived generation can be added when module schemas exist.                                                                                                                                              |
| **`packages/shared` consumed as TypeScript source**             | No build step for the shared package. Vite, tsx and Vitest compile it directly, and `tsup` bundles it into the server's `dist/`.                                                                                                                                                                             |
| **Express 5 `req.query` is read-only**                          | The `validate()` middleware writes parsed input to `req.valid`. Body sanitising strips `$`-prefixed and dotted keys; query strings are protected by strict Zod schemas.                                                                                                                                      |
| **Development preview session (client)**                        | Used during Phase 1 only; removed in Phase 2 when real sign-in shipped.                                                                                                                                                                                                                                      |

### Dependency versions in use (resolved 2026-11-06)

Node 24, TypeScript 6, React 19.3, React Router 8, Vite 8, Tailwind 4.3, Express 5.3, Mongoose 9, BullMQ 6, ioredis 6, Socket.IO 4.8, Zod 4.6, Vitest 5.

## Phase 2 additions

- **Request context:** `authenticate` resolves the user, roles and merged permission map from MongoDB on every request (`core/rbac/context.ts`). `authorize(permission, minScope)` guards routes; services apply record-level scope with `core/rbac/policy.ts`.
- **Audit:** services call `recordAudit(rc, entry)` after a successful change. It never throws, so an audit write failure cannot undo a completed business action; failures are logged at error level.
- **E-mail:** services call `sendEmail()`, which enqueues on BullMQ; the worker delivers with retries. Tests swap the transport with `setEmailTransport()`.
- **Client session:** `SessionProvider` restores the session from the refresh cookie on load. `RequireAuth` and `PublicOnly` guard routes. The access token lives only in memory inside the API client, never in Redux or storage.

## Hosting decision change (2026-11-06)

The user chose cloud hosting (Option A): the web app on **Vercel**, and the API and worker as Docker containers on **Render**, with MongoDB Atlas, Render Key Value (Redis), S3/R2 and an SMTP provider. This replaces the original on-prem Docker Compose target. The application code is unchanged; see docs/deployment.md. Local development still uses docker-compose.yml for the supporting services.

## Phase 3 additions

- **Ordering:** board and list order use fractional ranks (`packages/shared/src/rank.ts`), so a move updates one document. Appends grow by about one character per 61 items; repeated inserts at the same spot grow faster and can be rebalanced later if needed.
- **Dates:** date-only fields (start, end, due) are stored as `YYYY-MM-DD` strings of the organisation calendar, which avoids timezone drift. Overdue means `dueDate < orgToday()`.
- **Task drawer:** any page can open a task with `?task=<id>` (shareable links). A single `TaskDrawerHost` lives in the app shell.
- **Code splitting:** module pages are lazy-loaded (`routes.tsx`). The initial bundle went from 982 kB to 392 kB.
- **DataTable:** cell and header renderers are called as plain functions. TanStack's `flexRender` mounted inline renderers as new components on every render. Renderers must not use hooks.
- **Form accessibility:** `FormField` shares its label id through `FieldContext`, so composite controls (Select, person pickers) inside react-hook-form Controllers are labelled for screen readers.
- **Libraries:** dnd-kit (board), FullCalendar 6.1 (calendar; v7 is a new major and was not adopted), and a custom timeline (FullCalendar's timeline is a paid plugin).

## Phase 4 additions: Smart Assignment Engine

- **Engine** (`server/src/modules/assignment/engine.ts`): pure scoring and planning functions. Factors, all normalised 0..1: workload `1 − load/capacity`; capacity `(capacity − load − effort)/capacity`; skill `mean(level/5)` over required skills; priority/complexity fit `1 − |complexity − proficiency|/4` (critical tasks use `proficiency/5`); availability `availableDays/horizonDays`. Hard rules: required skill levels, approved leave, capacity (unless allowed), active and on the team. Ties go to the least recently assigned, then fewest open tasks, then id, so the result is deterministic.
- **Batch allocation** is greedy in urgency order (priority, due date, larger effort first) with running loads, so equal people with equal tickets receive equal shares (100 tickets across 4 testers gives 25 each, covered by tests).
- **Workload** (`workload.service.ts`) counts remaining effort of open tasks across all projects (started work counts max(estimate − actual, 25%)). Capacity = weekly hours / working days × available working days in the planning window after approved leave (partial availability counts proportionally).
- **Candidate pool**: active project members and leads by default; managers and viewers only when listed explicitly.
- **Plans** (`assignmentPlans`): preview → optional overrides → approve → execute. Approval flips the status atomically, so concurrent approvals dispatch once. The BullMQ job id is the plan's idempotency key. Execution takes a MongoDB-backed lock per pool (`core/lock.ts`, works across API replicas and the worker), re-validates each task (unchanged `assignmentVersion` and assignee) and person (active, on the team, capacity), and commits task + history in one transaction. Problems are reported as conflicts, never overwritten.
- **Auto-assignment**: projects can opt in (`autoAssign`). A `task.created` subscriber assigns the best eligible member under the same lock, recorded as `method: auto, triggeredBy: automation`.
- **Reassignment / rebalancing** never move in-progress or critical work automatically; those go to manual review.
- **Time tracking**: date-only work logs in the organisation calendar; ranges stored as instants for overlap checks; `Task.actualHours` is recomputed from logs. Timesheets lock their week once submitted.
- **Scheduled jobs** (worker): Monday 11:00 (organisation timezone) timesheet reminders via BullMQ job schedulers.
