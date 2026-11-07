# Arihant Workspace - Security Architecture

> Source: architecture review approved on 2026-11-06. Update this document as the implementation evolves.

## 18. Security architecture

- **Passwords:** argon2id; password policy (≥10 characters, breached-list check optional); account lockout after 5 failures for 15 min.
- **Tokens:** access JWT (15 min) sent as a bearer header and held in memory on the client. The refresh token (7 days) is opaque, stored hashed, and lives in an **HttpOnly, Secure, SameSite=Strict cookie** scoped to `/api/v1/auth`. Rotation runs on every refresh; **reuse detection revokes the whole token family**. A `tokenVersion` on the user allows global logout.
- **Authorisation:** backend `authorize()` plus `scopeFilter()` on every query; object-level checks on `:id` routes; tests cover each role.
- **Input:** Zod strict schemas (unknown keys rejected); `express-mongo-sanitize`-style stripping of `$` and `.`; Mongoose `strictQuery`.
- **Transport and HTTP:** HTTPS at Nginx, HSTS, Helmet CSP, CORS allow-list from env, rate limits (global plus stricter on auth and AI), body size limits.
- **Uploads:** 25 MB cap, extension and magic-byte allow-list, randomised storage keys, private bucket, short-lived presigned download URLs after a permission check, optional ClamAV hook.
- **Secrets:** `.env` files are gitignored (`.env.example` committed); production secrets are injected via Docker secrets; env validated at boot.
- **Audit:** login and logout, role and permission changes, assignment and reassignment, approvals, deletions, exports and settings changes go to append-only `auditLogs`.
- **Errors:** sanitised messages; stack traces only in development.
- **Data:** seed and test data are synthetic (faker), clearly labelled `DEV`. Seeding is blocked when `NODE_ENV=production`.

## 11. Role and permission matrix

Permissions use the form `resource:action` with a **scope** granted per role: `own` < `team` (direct reports) < `project` (member/manager) < `department` < `org`. The `authorize()` middleware checks the action. Then `policy.scopeFilter(user, resource)` returns a Mongo filter that **every list query, report and export** must AND into its query. That one function enforces "reports use the same authorised data".

| Capability                        | Super Admin | Director   | Dept Head                 | PM           | Team Lead    | Dev                | QA                 | Employee       | Ext. Stakeholder |
| --------------------------------- | ----------- | ---------- | ------------------------- | ------------ | ------------ | ------------------ | ------------------ | -------------- | ---------------- |
| System settings, roles, audit     | org         | read audit | —                         | —            | —            | —                  | —                  | —              | —                |
| Users / departments manage        | org         | read org   | dept (read+avail approve) | —            | —            | —                  | —                  | —              | —                |
| Projects create/edit              | org         | org        | dept                      | project      | read project | read project       | read project       | read project   | shared (read)    |
| Tasks create/edit                 | org         | org        | dept                      | project      | project      | project (own edit) | project (own edit) | own            | —                |
| Assign / smart-assign / rebalance | org         | org        | dept                      | project      | team         | —                  | —                  | —              | —                |
| Work logs                         | org read    | org read   | dept read                 | project read | team read    | own                | own                | own            | —                |
| Timesheet approve                 | org         | —          | dept                      | project      | team         | —                  | —                  | —              | —                |
| Analytics & reports               | org         | org        | dept                      | project      | team         | own                | own                | own            | —                |
| Risks                             | org         | org        | dept                      | project      | project      | project (raise)    | project (raise)    | —              | —                |
| Approvals                         | org         | org        | dept                      | project      | team         | —                  | —                  | —              | sign-off only    |
| Documents                         | org         | org        | dept                      | project      | project      | project            | project            | project (read) | shared           |
| Automations                       | org         | —          | dept                      | project      | —            | —                  | —                  | —              | —                |
| AI assistant / Ask Your Data      | org         | org        | dept                      | project      | team         | own                | own                | own            | —                |

Roles are custom-editable, so this matrix is only the seeded default. QA "eligible testing tickets" means tasks in `Testing` status, or with a `qa` skill requirement, in projects where the tester is a member.

## Implementation status (Phase 2)

| Control                                                                                                                                       | Where                                               | Verified by                            |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------- |
| argon2id password hashing (`@node-rs/argon2`, OWASP minimum parameters)                                                                       | `server/src/core/auth/password.ts`                  | auth integration tests                 |
| Similar timing for unknown e-mails (dummy hash verification) and one generic error message                                                    | `auth.service.ts` `login`                           | test "same generic error"              |
| Lockout after `LOGIN_MAX_ATTEMPTS` failures for `LOGIN_LOCK_MINUTES` (atomic counter)                                                         | `auth.service.ts`                                   | test "locks the account"               |
| Access JWT (HS256, issuer/audience pinned, 15 min) held in memory on the client                                                               | `core/auth/jwt.ts`, `client/services/api/client.ts` | unit + client tests                    |
| Opaque refresh token, SHA-256 hashed at rest, HttpOnly + SameSite=Strict + path-scoped cookie                                                 | `session.service.ts`, `auth.controller.ts`          | test "returns an access token…"        |
| Rotation on every refresh; reuse after a 10 s grace window revokes the whole token family                                                     | `auth.service.ts` `refresh`                         | test "detects reuse…"                  |
| `tokenVersion` checked on every request: logout-all, password change and deactivation take effect immediately                                 | `core/rbac/context.ts`                              | tests "logout-all…", "deactivating…"   |
| Permissions resolved from the database per request, so role edits apply on the next request                                                   | `loadAuthContext`                                   | test "a role edit takes effect…"       |
| Scope filters on directory reads; out-of-scope records return 404                                                                             | `core/rbac/policy.ts`                               | test "limits the directory…"           |
| Privilege-escalation guards: only Super Admin grants Super Admin; the last Super Admin cannot be removed or deactivated; no self-deactivation | `user.service.ts`                                   | org integration tests                  |
| Single-use, hashed, expiring invite/reset links; newer links invalidate older ones; reset revokes all sessions                                | `session.service.ts`, `auth.service.ts`             | auth integration tests                 |
| No account enumeration on forgot-password                                                                                                     | `forgotPassword`                                    | test "does not reveal unknown e-mails" |
| Append-only audit log (Mongoose hooks block update/delete; no API route) with secret redaction                                                | `audit-log.model.ts`, `audit.service.ts`            | test "no way to modify them"           |
| Open-redirect protection on `?next=` after sign-in                                                                                            | `client/src/lib/redirect.ts`                        | client test                            |
| Auth endpoints rate-limited (Redis-backed, shared across replicas)                                                                            | `middleware/rate-limit.ts`                          | configuration                          |

## Implementation status (Phase 3)

| Control                                                                                                                                                                                                                 | Where                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Record-level scoping for projects and tasks (own / team / project / department / org); out-of-scope records return 404                                                                                                  | `server/src/core/rbac/work-access.ts`     |
| Write rules: project edits by manager/lead (project scope) or broader roles; task edits by assignee/reporter (own scope) or project members; cancelling a task needs delete rights                                      | `work-access.ts`, `task.service.ts`       |
| Archived projects are read-only for every role                                                                                                                                                                          | `task.service.ts`, `project.service.ts`   |
| Optimistic concurrency: project `version`; task `assignmentVersion` (prevents silent overwrite of a concurrent reassignment)                                                                                            | services                                  |
| Uploads: real type detected from file bytes (never the browser MIME); Office files require a matching extension; text must be valid UTF-8 without control bytes; 25 MB limit; random storage keys; file names sanitised | `attachment.service.ts`                   |
| Downloads only through short-lived (5 min) pre-signed URLs issued after an access check; `Content-Disposition: attachment`                                                                                              | `services/storage.ts`                     |
| Comments rendered as text (no HTML injection); mentions limited to project members                                                                                                                                      | `CommentsPanel.tsx`, `comment.service.ts` |

## Implementation status (Phase 4)

| Control                                                                                                                                                                                            | Where                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| People-scoped visibility for work logs, journals, timesheets, leave, workload and passport (own / team / project / department / org)                                                               | `core/rbac/work-access.ts` (`peopleFilter`, `canSeePerson`) |
| Self-approval of timesheets and leave is impossible                                                                                                                                                | `people.service.ts`                                         |
| Work Passport is operational history only (no scoring) and visible to the person and their manager chain                                                                                           | `people.service.ts`                                         |
| Work logs: only on your projects or tasks assigned to you; no future dates, overlaps or more than 24 h a day; locked weeks immutable                                                               | `worklog.service.ts`                                        |
| Assignment: permission per project; plans visible only to their creator (or organisation scope); execution re-validates everything under a distributed lock and records an audit event on approval | `assignment.service.ts`                                     |

## Phase 8 security review (2026-11-06)

| Check                                            | Result                                                                                                                                                                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production dependencies (`npm audit --omit=dev`) | 2 moderate: `uuid` < 11.1.1 through `exceljs`. Not reachable (exceljs only calls `uuid.v4()` without a buffer). Accepted until exceljs updates; CI fails on any high or critical advisory. Dev-only: `minimatch` in ESLint tooling. |
| Secrets in the source tree                       | None found; `.env` / `.env.*` gitignored; backups and Playwright output gitignored.                                                                                                                                                 |
| Authentication coverage                          | Every router except health and readiness requires sign-in (verified by reading each router and live: unauthenticated `/projects` returns 401).                                                                                      |
| HTTP headers                                     | Verified live: HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy: no-referrer`, COOP / CORP; CSP enabled in production.                                                                                                          |
| Input                                            | 1 MB JSON limit; `$` / dotted keys and prototype keys stripped; strict Zod schemas; multipart `meta` JSON parsed and validated the same way.                                                                                        |
| Rate limits                                      | Redis-backed: 300 requests per minute per IP on the API, 20 per 15 minutes on sign-in, refresh and password endpoints (confirmed in practice: E2E runs hit it), per-person daily AI limit.                                          |
| Readiness endpoint                               | Public by design for health checks; returns status, uptime, version and dependency latencies, no hostnames or credentials.                                                                                                          |
| Backups                                          | Archive checksum verified before restore; restore refuses without typing the target database name; credentials redacted from output.                                                                                                |

## Git integration (2026-11-07)

- The GitHub webhook is the only unauthenticated write endpoint. It accepts a delivery only with a valid HMAC-SHA256 signature over the raw body (constant-time comparison) made with `GITHUB_WEBHOOK_SECRET`; without the secret the endpoint refuses everything (503).
- Only repositories an administrator lists are processed; others are acknowledged and ignored. Each delivery id is processed once.
- Automatic status changes are limited to moving open work to In review, never reopen or close tasks, never touch archived projects, and are recorded in the audit log (actor: GitHub).
- Commit and pull request details shown on a task are visible only to people who can see that task.

## Search and workflows (2026-11-07)

- The query language is parsed into a fixed set of fields and operators and compiled to a database filter; no user text reaches the database as an operator or code. Text is matched literally (regular-expression characters escaped). Every query is combined with the caller's read permissions; a project key the caller cannot see is reported as "no project that you can see" so its existence is not revealed.
- Shared filters share the query, not the results: each person sees only tasks they may read. Only the owner (or an administrator) changes a filter; sharing with the whole organisation needs department-level access.
- Search exports are limited to 10,000 rows, neutralise spreadsheet formulas and are audited.
- Workflow role restrictions, assignee-only moves, required fields and approvals are enforced on the server for every channel (panel, board, bulk edit, approvals); GitHub moves respect the workflow. Workflow changes and project workflow switches are audited.

## Two-step verification, API tokens, SSO and restrictions (2026-11-07)

- Two-step verification uses TOTP (RFC 6238) implemented with Node's crypto. Secrets are encrypted with AES-256-GCM (`DATA_ENCRYPTION_KEY`; derived from `JWT_ACCESS_SECRET` with HKDF when unset). Recovery codes are stored as SHA-256 hashes and work once. The sign-in step token has its own audience, lasts 5 minutes and cannot be used as an access token. A code is accepted at most once (conditional update on the last used time step). Wrong codes count towards the lockout.
- API tokens are random (240 bits), shown once and stored as SHA-256 hashes. They are off by default, expire (administrator maximum), can be read-only, never reach `/auth` or `/security`, and stop working when the owner is deactivated or tokens are switched off. Creation and revocation are audited.
- Single sign-on uses the authorization code flow with PKCE (S256), a one-time state (10 minutes) and a nonce; ID tokens are verified against the provider's published keys (issuer, audience, expiry). Accounts are never created automatically; an account is linked to one provider identity. When enforced, password sign-in is refused for people who use SSO, except super administrators.
- Restricted tasks and confidential projects are enforced in the central read filters used by lists, boards, search, exports and detail views; activity feeds leave out restricted tasks the reader cannot see.

## Outgoing integrations (2026-11-07)

- Destinations are managed by administrators only. Their addresses (Slack and Teams addresses contain a secret) and webhook signing secrets are stored encrypted; the secret is shown once.
- In production, outgoing calls go only to public https addresses (the host is resolved and private, loopback and link-local ranges are refused) and redirects are not followed, so the feature cannot be used to reach internal systems.
- Messages never include restricted tasks, confidential projects or comment text.
- GitLab (`X-Gitlab-Token`, constant-time comparison) and Bitbucket (HMAC-SHA256) webhooks are verified like GitHub's, with their own secrets, and share the repository allow-list and redelivery protection.

## Scheduled reports and the installable app (2026-11-07)

- Scheduled report attachments are generated separately for every recipient with that person's own permissions (read filters, analytics scope); recipients without access are skipped. Recipients must be active internal users. Attachments travel through the e-mail queue as base64 and are not stored.
- The service worker never caches API responses or pages with data; only hashed static files, icons and an offline page are kept on the device, so signing out leaves no work data behind.

## Service desk (2026-11-07)

- People raising requests do not get access to the service project: the request is created on their behalf with the project manager as reporter and without them as a watcher, and they read it only through the Help Center endpoints, which return their own requests, the answers they gave and the replies marked for them. Internal comments, activity and other requests stay with the team.
- Confidential projects cannot run a public service desk; external stakeholders cannot raise requests.
- Form answers are validated on the server against the request type (types, choices, required and conditional fields); hidden answers are dropped.
