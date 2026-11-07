# Arihant Workspace

**One Platform. Every Project. Every Task. Every Hour. Complete Visibility.**

Enterprise project, work and business-intelligence platform for Arihant Capitals: projects, tasks, smart capacity-aware assignment, work logs and timesheets, analytics, meetings, documents, risks, approvals, releases, automation and an AI assistant.

> Status: **Phase 2 (Authentication & Organization) complete.** Feature modules are delivered phase by phase; see [PROGRESS.md](PROGRESS.md).

## Stack

| Layer          | Technology                                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client         | React 19, TypeScript, Vite, Tailwind CSS 4, shadcn/ui (Radix), Redux Toolkit, TanStack Query & Table, React Router, React Hook Form + Zod, Socket.IO client |
| Server         | Node.js, Express 5, TypeScript, MongoDB (Mongoose, replica set), Redis, BullMQ, Socket.IO, Pino, Zod                                                        |
| Shared         | `packages/shared`: enums, permission catalogue, API contracts and Zod schemas used by both sides                                                            |
| Infrastructure | Vercel (web), Render Docker containers (API and worker), MongoDB Atlas, Redis, S3-compatible storage, SMTP. Docker Compose for local development            |
| Tests          | Vitest, Supertest, mongodb-memory-server, Testing Library (Playwright E2E in Phase 8)                                                                       |

## Repository layout

```
arihant-workspace/
├── client/            React SPA (features/, components/{ui,common,layout}, services/api, store, routes)
├── server/            Express API + BullMQ worker (config/, core/, middleware/, modules/, jobs/, sockets/)
├── packages/shared/   Contracts shared by client and server
├── docs/              PRD, SRS, architecture, database, API, security, testing, UI, deployment, roadmap
├── docker/            Container configuration
├── docker-compose.yml Development infrastructure
└── PROGRESS.md        Module-by-module delivery status
```

## Getting started

Prerequisites: Node 22 or later, Docker Desktop.

```bash
cp .env.example server/.env
npm install
docker compose up -d --wait
npm run dev
```

Then open http://localhost:5173. API docs are at http://localhost:4000/api/docs and captured e-mail at http://localhost:8025.

Create the first administrator, then sign in:

```bash
SEED_ADMIN_EMAIL=admin@arihant.local SEED_ADMIN_NAME="Platform Admin" SEED_ADMIN_PASSWORD="<strong password>" npm run seed:admin -w server
npm run seed:dev -w server   # optional synthetic DEV departments and employees
```

## Scripts

| Command                              | Purpose                                                         |
| ------------------------------------ | --------------------------------------------------------------- |
| `npm run dev`                        | API, worker and client with hot reload                          |
| `npm test`                           | All test suites                                                 |
| `npm run typecheck`                  | TypeScript across workspaces                                    |
| `npm run lint` / `npm run format`    | ESLint / Prettier                                               |
| `npm run build`                      | Production builds (server via tsup, client via Vite)            |
| `npm run test:e2e`                   | Playwright end-to-end tests against a running stack             |
| `npm run backup` / `npm run restore` | Database and file backup / restore (see docs/backup-restore.md) |

## Documentation

Start with [docs/architecture.md](docs/architecture.md). The other documents cover the product (PRD/SRS), data model, API, security, testing, UI system, deployment and roadmap.

## Deployment

The web app deploys to **Vercel** and the API and worker to **Render** (`render.yaml`, `server/Dockerfile`). See [docs/deployment.md](docs/deployment.md).
