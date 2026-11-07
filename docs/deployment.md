# Arihant Workspace - Deployment Guide

> Source: architecture review approved on 2026-11-06. Update this document as the implementation evolves.

## 20. Deployment architecture (on-prem)

- **`docker-compose.yml` (development):** mongo (RS init), redis, minio + bucket init, mailpit. The API and client run on the host with hot reload (`npm run dev`).
- **`docker-compose.prod.yml`:** nginx (TLS, serves the built SPA, proxies `/api` and `/socket.io` with sticky-free Redis adapter), `api` ×2, `worker` ×1, mongo 3-node RS, redis (AOF), minio, plus a backup sidecar.
- **Backups:** nightly `mongodump` (gzip, 30-day retention) plus `mc mirror` of MinIO to a secondary disk or NAS; a restore runbook is tested quarterly.
- **Git integration:** set `GITHUB_WEBHOOK_SECRET` on the API (a long random value). In each GitHub repository add a webhook: payload URL `https://<app host>/api/v1/integrations/github/webhook`, content type application/json, the same secret, events "Pushes" and "Pull requests". Then list the repository under System Settings → GitHub integration and switch it on.
- **Security:** set `DATA_ENCRYPTION_KEY` (32 random bytes, base64) on the API before people turn on two-step verification; changing it later makes existing enrolments unreadable (they must be reset). For single sign-on, register an app with the provider (redirect URI `https://<app host>/api/v1/auth/sso/callback`), set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` and `OIDC_PROVIDER_NAME`, then switch it on in System Settings → Security.
- **GitLab / Bitbucket:** set `GITLAB_WEBHOOK_SECRET` / `BITBUCKET_WEBHOOK_SECRET`; webhook URLs `https://<app host>/api/v1/integrations/gitlab/webhook` (Push and Merge request events, the secret as "Secret token") and `…/bitbucket/webhook` (Repository push and Pull request events, the secret). List the repositories under System Settings → GitHub integration. Slack, Teams and other outgoing destinations are added in System Settings → Outgoing integrations; the worker must run for retries.
- **CI/CD:** GitHub Actions runs lint, typecheck, tests, builds images and pushes to a private registry. The deploy job (manual approval) SSHes to the server and runs `docker compose pull && up -d`. Environments are dev, staging and prod, each with its own env file and database.
- **Observability:** `/health` (liveness) and `/ready` (Mongo/Redis/MinIO checks), Pino logs to stdout collected with Docker logging (Loki optional), BullMQ dashboard behind admin auth.

## Local development

Prerequisites: Node 22 or later (developed on 24), Docker Desktop.

```bash
cp .env.example server/.env      # development defaults; never commit real secrets
npm install
docker compose up -d --wait      # MongoDB replica set, Redis (host 6380), SeaweedFS S3 (8333), Mailpit (8025)
npm run dev                      # API :4000, worker, client :5173 (proxies /api and /socket.io)

# First Super Admin (prompt-free; values shown are examples, use your own)
SEED_ADMIN_EMAIL=admin@arihant.local SEED_ADMIN_NAME="Platform Admin" SEED_ADMIN_PASSWORD="<strong password>" npm run seed:admin -w server
# Optional synthetic DEV data (refuses to run outside NODE_ENV=development)
npm run seed:dev -w server       # 3 DEV departments, 12 DEV employees, password DevPass2026!
```

| Service                   | URL                                |
| ------------------------- | ---------------------------------- |
| Web app                   | http://localhost:5173              |
| API docs (Swagger)        | http://localhost:4000/api/docs     |
| Readiness                 | http://localhost:4000/api/v1/ready |
| Mailpit (captured e-mail) | http://localhost:8025              |

The MongoDB container initialises replica set `rs0` on first boot (see its healthcheck). Transactions need a replica set. In development the API creates the S3 bucket if it is missing; in production the bucket is provisioned by operations.

`docker-compose.prod.yml`, the Nginx configuration, Dockerfiles and the GitHub Actions pipeline are delivered in Phase 8.

## Production: Vercel (web) + Render (API and worker)

Hosting decision changed on 2026-11-06 from on-prem Docker Compose to cloud: Vercel serves the web app and Render runs the API and worker containers. This moves company data to external providers; choose Indian or nearby regions and confirm with compliance before loading real data.

```
Browser ──► Vercel (bom1)  ── static React app
              │ /api/*  (rewrite proxy: same origin, so the HttpOnly refresh cookie works)
              ▼
           Render: arihant-workspace-api  (Docker, server/Dockerfile)  ──► MongoDB Atlas (Mumbai)
           Render: arihant-workspace-worker (same image, `node dist/worker.js`)
           Render Key Value (Redis, noeviction)    S3 / R2 (files)    SMTP provider (e-mail)
```

Why not everything on Vercel: the BullMQ worker needs an always-on process, and Socket.IO needs long-lived connections. Vercel functions provide neither.

### 1. External services

| Service        | Recommendation                                                     | Notes                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MongoDB        | MongoDB Atlas, region **Mumbai (ap-south-1)**; M10+ for production | Atlas clusters are replica sets, so transactions work. Allow Render's outbound IPs (or 0.0.0.0/0 with a strong password during setup).                                          |
| Object storage | AWS S3 `ap-south-1` or Cloudflare R2                               | Create a **private** bucket. For AWS set `S3_FORCE_PATH_STYLE=false` and leave `S3_ENDPOINT` unset or use the regional endpoint. The API does not create buckets in production. |
| E-mail         | Amazon SES (Mumbai) SMTP, Resend or SendGrid                       | Verify the sender domain; set `MAIL_FROM`.                                                                                                                                      |
| Redis          | Render Key Value (created by the blueprint)                        | `maxmemoryPolicy: noeviction` is required by BullMQ.                                                                                                                            |

### 2. Deploy the API and worker on Render

1. Push the repository to GitHub.
2. Render dashboard → **New → Blueprint** → select the repository. `render.yaml` creates the API, the worker, Redis and an environment group.
3. Fill in the `sync: false` variables in the **arihant-workspace-shared** group:
   `MONGO_URI`, `APP_ORIGIN` (your Vercel URL, comma-separate several), `PUBLIC_APP_URL` (same URL, used in e-mail links), `S3_*`, `SMTP_*`, `MAIL_FROM`.
   `JWT_ACCESS_SECRET` is generated by Render; `TRUST_PROXY_HOPS=2` matches Vercel + Render.
4. After the first deploy, open the API service **Shell** and create the first administrator:
   ```bash
   SEED_ADMIN_EMAIL=you@company.com SEED_ADMIN_NAME="Your Name" SEED_ADMIN_PASSWORD='<strong password>' node dist/scripts/seed-admin.js
   ```
5. Check `https://<api-host>/api/v1/ready`: every check should be `ok: true`.

### 3. Deploy the web app on Vercel

1. Point `/api` at the API host and commit:
   ```bash
   npm run vercel:api-host -- https://arihant-workspace-api.onrender.com
   ```
   The Vercel build fails on purpose while the placeholder host is still in `vercel.json`.
2. Vercel → **Add New Project** → import the repository. Leave **Root Directory** as the repository root; `vercel.json` sets the install command, build command, output directory (`client/dist`), region (`bom1`), the `/api` proxy, the SPA fallback and security headers. No Vercel environment variables are needed.
3. Add the Vercel URL (and any custom domain) to `APP_ORIGIN` and `PUBLIC_APP_URL` on Render, then redeploy the API.

### 4. Custom domains (recommended)

Use e.g. `workspace.arihantcapital.com` on Vercel. Optionally give the API its own subdomain (`api.workspace…`) on Render. Keep the browser talking only to the Vercel domain (via the `/api` rewrite) so cookies stay first-party.

### Notes

- **Real-time (Phase 6):** Vercel rewrites do not proxy WebSockets. The client will connect Socket.IO directly to the API host; `APP_ORIGIN` already drives its CORS allow-list.
- **Logs:** the API and worker log JSON to stdout (Render log streams).
- **Backups:** enable Atlas continuous backup and bucket versioning, and run `npm run backup` nightly from a secured host for a provider-independent copy. See [backup-restore.md](backup-restore.md).
- **Security:** set `DATA_ENCRYPTION_KEY` (32 random bytes, base64) on the API before people turn on two-step verification; changing it later makes existing enrolments unreadable (they must be reset). For single sign-on, register an app with the provider (redirect URI `https://<app host>/api/v1/auth/sso/callback`), set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` and `OIDC_PROVIDER_NAME`, then switch it on in System Settings → Security.
- **GitLab / Bitbucket:** set `GITLAB_WEBHOOK_SECRET` / `BITBUCKET_WEBHOOK_SECRET`; webhook URLs `https://<app host>/api/v1/integrations/gitlab/webhook` (Push and Merge request events, the secret as "Secret token") and `…/bitbucket/webhook` (Repository push and Pull request events, the secret). List the repositories under System Settings → GitHub integration. Slack, Teams and other outgoing destinations are added in System Settings → Outgoing integrations; the worker must run for retries.
- **CI/CD:** `.github/workflows/ci.yml` runs on every pull request and push. `.github/workflows/deploy.yml` is started by hand (type "deploy"), reruns all checks, waits for approval on the `production` GitHub environment, then calls the Render deploy hooks (secrets `RENDER_DEPLOY_HOOK_API`, `RENDER_DEPLOY_HOOK_WORKER`), waits for `/api/v1/ready` (variable `PRODUCTION_API_URL`) and calls the Vercel deploy hook (`VERCEL_DEPLOY_HOOK`). Turn off automatic deploys on Render and Vercel if all production deploys should go through this workflow.
- **Verified locally (2026-11-06):** the production image ran with `NODE_ENV=production` against the Docker services. Health and readiness passed, Swagger was hidden, the refresh cookie was `Secure; HttpOnly; SameSite=Strict`, the client IP was resolved correctly through 2 proxy hops, the container ran as non-root, the worker delivered a reset e-mail whose link used `PUBLIC_APP_URL`, and `dist/scripts/seed-admin.js` ran inside the container. Not yet verified: an actual Vercel/Render deployment, which needs your accounts.
