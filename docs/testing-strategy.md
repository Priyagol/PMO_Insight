# Arihant Workspace - Testing Strategy

> Source: architecture review approved on 2026-11-06. Update this document as the implementation evolves.

## Running the server suites on a small machine

The server integration suites each start an in-memory MongoDB replica set. On an 8 GB laptop with other programs open, running them all in parallel can exhaust memory before any assertion runs. Use `npx vitest run --maxWorkers=2` in `server/` (about 5 minutes); CI machines can use the default.

## End-to-end tests that need the DEV administrator

`e2e/tests/workflow.spec.ts` creates a workflow, which needs an administrator. Its sign-in is read from `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD`; the test is skipped when they are not set. Never put the values in the repository.

## 19. Testing strategy

- **Server unit** (Jest): assignment scoring and planning as pure functions, health and progress calculators, condition evaluator, policy scope filters.
- **Server integration** (Jest + Supertest + mongodb-memory-server RS): every endpoint returns the happy path, 400 validation, 401, 403 per role, and 404/409.
- **Assignment scenarios** (from brief §12): 100 tickets with 4 equal testers (25/25/25/25), unequal existing load, different capacities, skill mismatch, approved leave, critical tickets, no eligible users (all skipped with reasons), 10 concurrent batch requests (no over-allocation or duplicates), reassignment and rebalance.
- **Client** (Vitest + RTL + MSW): shared components, forms and validation, Redux slices, query hooks.
- **E2E** (Playwright, against a Compose stack with seeded data): login, project create, task create/assign, Kanban drag, work-log and timer, timesheet submit/approve, smart batch allocation, report export, permission restriction.
- **CI gate:** lint + typecheck + unit + integration on every PR; E2E on main. Results are reported only from actual runs.

## Running the server suites on a small machine

The server integration suites each start an in-memory MongoDB replica set. On an 8 GB laptop with other programs open, running them all in parallel can exhaust memory before any assertion runs. Use `npx vitest run --maxWorkers=2` in `server/` (about 5 minutes); CI machines can use the default.

## End-to-end tests that need the DEV administrator

`e2e/tests/workflow.spec.ts` creates a workflow, which needs an administrator. Its sign-in is read from `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD`; the test is skipped when they are not set. Never put the values in the repository.

## Running tests

```bash
npm test                 # all workspaces
npm test -w server       # API: unit + integration (in-memory MongoDB replica set, no Docker needed)
npm test -w client       # React components, store, API client (jsdom)
npm run typecheck && npm run lint
```

The first server run downloads a MongoDB binary for `mongodb-memory-server`.

### Running the server suites on a small machine

The server integration suites each start an in-memory MongoDB replica set. On an 8 GB laptop with other programs open, running them all in parallel can exhaust memory before any assertion runs. Use `npx vitest run --maxWorkers=2` in `server/` (about 5 minutes); CI machines can use the default.

## End-to-end tests that need the DEV administrator

`e2e/tests/workflow.spec.ts` creates a workflow, which needs an administrator. Its sign-in is read from `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD`; the test is skipped when they are not set. Never put the values in the repository.

## End-to-end (Playwright)

`e2e/` drives a real browser (Chromium) against a running stack with the synthetic DEV seed:

```bash
npm run dev:infra && npm run seed:dev -w server && npm run dev   # in another terminal
npx playwright install chromium                                   # once
npm run test:e2e                                                  # E2E_BASE_URL overrides http://localhost:5173
```

Covered: wrong-password message; sign-in, reload and redirect to the requested page; developer blocked from roles and audit log; project manager creates a project and a task through the UI; release production deploy locked until go-live approval with a UAT deployment recorded; team member uploads a document and requests publication; project manager plans a sprint from the backlog, starts it and sees the agile fields in the task panel. Setup data is created through the API and labelled DEV. The suite signs in many times from one IP, so the target environment needs a higher `AUTH_RATE_LIMIT_MAX` (the local `.env` and CI use 500; production keeps the default 20). The config refuses hosts containing "arihant" unless `E2E_ALLOW_REMOTE=1`.

### Running the server suites on a small machine

The server integration suites each start an in-memory MongoDB replica set. On an 8 GB laptop with other programs open, running them all in parallel can exhaust memory before any assertion runs. Use `npx vitest run --maxWorkers=2` in `server/` (about 5 minutes); CI machines can use the default.

## End-to-end tests that need the DEV administrator

`e2e/tests/workflow.spec.ts` creates a workflow, which needs an administrator. Its sign-in is read from `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD`; the test is skipped when they are not set. Never put the values in the repository.

## Continuous integration

`.github/workflows/ci.yml`: on every pull request, format check, lint, typecheck, shared / server / client tests, build and `npm audit --omit=dev --audit-level=high`; on pushes to main the Playwright suite also runs against Docker services seeded with DEV data. Not yet run on GitHub (the local repository has no GitHub remote yet); the same steps were run locally.
