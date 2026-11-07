# Arihant Workspace - Software Requirements Specification

> Source: architecture review approved on 2026-11-06. Update this document as the implementation evolves.

## 3. Functional requirements

The functional requirements are modules 1–17 of the brief, kept as written. They are refined into these testable rules:

- **IDs:** project key (for example `TRD`) is user-defined, unique and uppercase, 2–6 characters. Task ID is `{KEY}-{seq}`, with the sequence taken from an atomic `counters` collection.
- **Status transitions** are governed by a per-project workflow (default graph below). Invalid transitions return 422.
  `Backlog→ToDo→InProgress→InReview→Testing→Done`; any open status ↔ `Blocked`; any → `Cancelled` (permission-gated); `Done` requires closure approval when the project setting is on.
- **Progress:** project progress = Σ(effort of Done tasks) / Σ(effort of non-cancelled tasks). Unestimated tasks count as 1 h.
- **Health score** (0–100, explainable): schedule variance 40%, effort overrun 20%, overdue-task ratio 20%, open high-severity risks 10%, blocked-task age 10%. Bands: ≥75 Healthy, 50–74 Watch, <50 At Risk (this suggests the `At Risk` status; it does not set it automatically without a PM).
- **Overdue:** `dueDate < now(org TZ)` and status not in {Done, Cancelled}. A scheduled job flags overdue tasks and emits an event.
- **Timer:** at most one running timer per user. Stopping a timer creates a WorkLog entry. Manual entries cannot overlap existing entries for the same user.
- **Timesheet:** a weekly aggregate of WorkLogs. Submitting locks the logs and rejecting unlocks them. Approvals are recorded.
- **Every mutating action** writes an Activity record (user-facing feed) and, when it is critical, an AuditLog record (immutable).

## 4. Non-functional requirements

- **Scale assumption:** ≤1,000 users, ≤5,000 projects, ≤1M tasks, ≤10M work logs over 5 years. The design targets 10× that.
- **Performance:** p95 API <300 ms for CRUD, <2 s for dashboards (pre-aggregated where needed), Kanban with 500 cards stays smooth (virtualised).
- **Availability:** 99.5% during business hours. RPO 24 h (nightly backups plus Mongo oplog for tighter recovery later), RTO 4 h.
- **Security:** see §18. **Accessibility:** WCAG 2.1 AA (shadcn/Radix gives keyboard and ARIA support). **Browsers:** latest Chrome, Edge and Firefox; responsive down to 375 px.
- **Time:** stored in UTC. The org timezone defaults to `Asia/Kolkata`, and all "day/week/month" boundaries use the org TZ. Fiscal year runs April–March.
- **Auditability:** AuditLog is append-only, with no update or delete API.
