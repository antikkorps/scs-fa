# syntax=docker/dockerfile:1
# Build context is the repo root: docker build -f apps/web/Dockerfile -t scs-web .

# ---- build: install the workspace and produce the Nitro output ----
FROM node:24-slim AS build
ENV CI=1
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
# Nuxt/Nitro bundles everything it needs (incl. @armurier/shared) into .output.
RUN pnpm --filter @armurier/web build

# ---- runtime: the Nitro output is self-contained, no node_modules needed ----
FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.output /app/.output
USER node
EXPOSE 3000

# API base / site URL are injected at runtime via NUXT_PUBLIC_* env, so the same
# image works across environments.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(()=>process.exit(0)).catch(()=>process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
