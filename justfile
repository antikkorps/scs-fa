# SCS Firearm — ops & deployment recipes.
#
# Runner: `just` (https://github.com/casey/just — `brew install just`).
# This complements the pnpm scripts: dev/build/test/lint stay in package.json;
# `just` wraps the production Docker Compose operations documented in
# docs/DEPLOY.md (§3–§7), so go-live steps are runnable instead of copy-pasted.
#
# Run `just` (no args) to list recipes. Meant to run from the repo root on the
# Hetzner host, where `.env` holds the production secrets.

set dotenv-load := true

compose := "docker compose -f docker-compose.prod.yml"

# List available recipes
default:
    @just --list

# Build images and (re)start the whole stack
deploy:
    {{ compose }} up -d --build

# Apply the DB schema (profile-gated migrate service)
migrate:
    {{ compose }} --profile migrate run --rm migrate

# Seed reference data + admin user (idempotent, safe to re-run)
seed:
    {{ compose }} exec api node_modules/.bin/tsx src/db/seed-cli.ts

# Update flow: pull, migrate, rebuild, prune dangling images
update:
    git pull
    {{ compose }} --profile migrate run --rm migrate
    {{ compose }} up -d --build
    docker image prune -f

# Start the stack (no rebuild)
up:
    {{ compose }} up -d

# Stop the stack (keeps named volumes)
down:
    {{ compose }} down

# Show service status
ps:
    {{ compose }} ps

# Follow logs for a service (default: api) — e.g. `just logs caddy`
logs service="api":
    {{ compose }} logs -f {{ service }}

# Restart a service (default: caddy) — e.g. `just restart api`
restart service="caddy":
    {{ compose }} restart {{ service }}

# Open a psql shell on the database
psql:
    {{ compose }} exec postgres psql -U ${POSTGRES_USER:-armurier} -d ${POSTGRES_DB:-armurier_prod}

# On-demand backup (same path the cron uses) → off-site S3
backup:
    {{ compose }} run --rm backup backup.sh

# List the dumps currently in the backup bucket
backups:
    {{ compose }} run --rm backup sh -c 'aws --endpoint-url "$S3_ENDPOINT" --region "$S3_REGION" s3 ls "s3://$S3_BUCKET/$BACKUP_S3_PREFIX/"'

# Restore a dump — DESTRUCTIVE (pg_restore --clean). Latest by default, or `just restore <dump>`.
restore dump="":
    #!/usr/bin/env bash
    set -euo pipefail
    read -rp "⚠️  This OVERWRITES the current database. Type 'yes' to continue: " ok
    [ "$ok" = "yes" ] || { echo "Aborted."; exit 1; }
    {{ compose }} run --rm backup restore.sh {{ dump }}
