# SCS Firearms — ops & deployment recipes.
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

# Create or update the least-privilege database roles (story 12.9f); safe to re-run
db-roles:
    {{ compose }} --profile db-roles run --rm db-roles

# Check infra/postgres/roles.sql against a throwaway Postgres (needs Docker; dev machine)
check-db-roles:
    ./infra/postgres/check-roles.sh

# Apply the DB schema (profile-gated migrate service)
migrate:
    {{ compose }} --profile migrate run --rm migrate

# Seed reference data + admin user (idempotent, safe to re-run). No demo content.
seed:
    {{ compose }} exec api node_modules/.bin/tsx src/db/seed-cli.ts

# Reference data + the demo catalogue (fake products, artworks, posts) — demo servers only, never the live site
seed-demo:
    {{ compose }} exec api node_modules/.bin/tsx src/db/seed-cli.ts --demo

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

# Search the persisted logs, last 14 days (default: the API) — e.g. `just journal 0b7d1f3e`
journal pattern container="scs-firearm-api-1":
    journalctl -t {{ container }} --since "-14d" --no-pager -g '{{ pattern }}'

# Restart a service (default: caddy) — e.g. `just restart api`
restart service="caddy":
    {{ compose }} restart {{ service }}

# Open a psql shell on the database
psql:
    {{ compose }} exec postgres psql -U ${POSTGRES_USER:-armurier} -d ${POSTGRES_DB:-armurier_prod}

# On-demand backup (same path the cron uses): the encrypted dump, then the objects
backup:
    {{ compose }} run --rm backup backup.sh
    {{ compose }} run --rm backup backup-objects.sh

# Check the backup image end to end: dump, restore, objects (needs Docker; dev machine)
check-backup:
    ./infra/backup/check-backup.sh

# List the encrypted dumps currently in the bucket
backups:
    {{ compose }} run --rm backup sh -c 'aws --endpoint-url "$S3_ENDPOINT" --region "$S3_REGION" s3 ls "s3://$S3_BUCKET/$BACKUP_S3_PREFIX/"'

# Runs as the schema owner, since the backup role may not write; the age private
# key is kept off the server and only mounted for the run.
# Restore a dump — DESTRUCTIVE. `just restore <age key file> [dump]`, latest by default
restore key dump="":
    #!/usr/bin/env bash
    set -euo pipefail
    [ -r "{{ key }}" ] || { echo "No readable age private key at {{ key }}"; exit 1; }
    read -rp "⚠️  This OVERWRITES the current database. Type 'yes' to continue: " ok
    [ "$ok" = "yes" ] || { echo "Aborted."; exit 1; }
    {{ compose }} run --rm -e PGUSER=scs_owner -e PGPASSWORD="$DB_OWNER_PASSWORD" \
      -v "$(realpath "{{ key }}"):/run/age-identity:ro" backup restore.sh {{ dump }}

# Adds and overwrites, never deletes. With a day, restores what that day's run
# saw deleted or overwritten.
# Copy backed-up objects back into the bucket: `just restore-objects [YYYY-MM-DD]`
restore-objects day="":
    {{ compose }} run --rm backup restore-objects.sh {{ day }}
