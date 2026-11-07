# Production image for the Arihant Workspace API and background worker.
# The combined entrypoint supervises both processes on a single free web instance.
# Build from the repository root: docker build -f server/Dockerfile .

FROM node:22-slim AS build
WORKDIR /repo
ENV MONGOMS_DISABLE_POSTINSTALL=1
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
RUN npm ci --workspace server --include-workspace-root --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY server server
RUN npm run build -w server

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
RUN npm ci --workspace server --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /repo/server/dist server/dist
WORKDIR /app/server
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/all.js"]
