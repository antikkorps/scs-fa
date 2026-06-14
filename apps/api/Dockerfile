# syntax=docker/dockerfile:1
# Build context is the repo root: docker build -f apps/api/Dockerfile -t scs-api .

# ---- build: install the workspace, then extract a self-contained API bundle ----
FROM node:24-slim AS build
ENV CI=1
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
# `pnpm deploy` copies the API plus its workspace deps (shared, kept as TS source)
# and prod node_modules (incl. tsx, which runs the TS at runtime) into /app.
RUN pnpm --filter @armurier/api deploy --legacy --prod /app

# ---- runtime ----
FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 8080

# The API runs the TypeScript source directly via tsx (no separate build step):
# this resolves the @armurier/shared workspace package, which is published as TS.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "src/index.ts"]
