# SCS Firearms — ops & deployment recipes.
#
# Runner: `just` (https://github.com/casey/just — `brew install just`).
# This complements the pnpm scripts: dev/build/test/lint stay in package.json;
# `just` wraps the production Docker Compose operations documented in
# docs/DEPLOY.md (§3–§7), so go-live steps are runnable instead of copy-pasted.
#
# Run `just` (no args) to list recipes. Meant to run from the repo root on the
# IONOS host, where `.env` holds the production secrets.

set dotenv-load := true

compose := "docker compose -f docker-compose.prod.yml"

# List available recipes
default:
    @just --list

# Check the whole .env for sample values, then build images and (re)start the whole stack
deploy:
    {{ compose }} --profile env-check run --rm --build env-check
    {{ compose }} pull --ignore-buildable
    {{ compose }} build --pull
    {{ compose }} up -d

# Create or update the least-privilege database roles (story 12.9f); safe to re-run
db-roles:
    {{ compose }} --profile db-roles run --rm db-roles

# Check infra/postgres/roles.sql against a throwaway Postgres (needs Docker; dev machine)
check-db-roles:
    ./infra/postgres/check-roles.sh

# Check the Caddyfile (origin certificate, no ACME) with the real Caddy image (needs Docker; dev machine)
check-caddyfile:
    ./infra/caddy/check-caddyfile.sh

# Run db-roles + migrate as production does, against a throwaway database (needs Docker; dev machine)
check-migrate:
    ./infra/postgres/check-migrate.sh

# Apply the DB schema (profile-gated migrate service)
migrate:
    {{ compose }} --profile migrate run --rm --build migrate

# Seed reference data (idempotent, safe to re-run). No demo content, and no admin in production: invite them.
seed:
    {{ compose }} exec api node_modules/.bin/tsx src/db/seed-cli.ts

# Again for the same admin: a new link, the previous one stops working. Ex: just admin-invite fred@scs-firearms.com Fred Martin
# Invite an admin: account without a password + single-use link (72 h) to choose one, e-mailed and printed
admin-invite email firstname +lastname:
    {{ compose }} exec api node_modules/.bin/tsx src/auth/admin-invite-cli.ts {{ email }} {{ firstname }} {{ lastname }}

# Reference data + the demo catalogue (fake products, artworks, posts) — demo servers only, never the live site
seed-demo:
    {{ compose }} exec api node_modules/.bin/tsx src/db/seed-cli.ts --demo

# Caddy reads its Caddyfile through a single-file mount: `git pull` replaces the
# file, the running Caddy keeps the old one, so it is recreated when they differ.
# Update (audit 2026-11-15, M2 + M4): fast-forward only; keep the running images as :previous
# (`just rollback`); refresh the base images and build BEFORE touching the database (a failed
# build leaves it as it was); check .env; back the database up; migrate; restart.
update:
    git pull --ff-only
    -docker image tag scs-api:latest scs-api:previous
    -docker image tag scs-web:latest scs-web:previous
    {{ compose }} pull --ignore-buildable
    {{ compose }} --profile migrate --profile env-check build --pull
    {{ compose }} --profile env-check run --rm env-check
    {{ compose }} run --rm backup backup.sh
    {{ compose }} --profile migrate run --rm --build migrate
    {{ compose }} up -d
    {{ compose }} exec -T caddy cat /etc/caddy/Caddyfile | cmp -s - Caddyfile || {{ compose }} up -d --force-recreate --no-deps caddy
    docker image prune -f

# Back to the images of before the last `just update`. The database stays migrated: migrations
# only add (columns, values), so the previous code runs on it; if not, restore the dump the update took.
rollback:
    docker image tag scs-api:previous scs-api:latest
    docker image tag scs-web:previous scs-web:latest
    {{ compose }} up -d --no-build

# Check the whole .env, then start the stack (no rebuild)
up:
    {{ compose }} --profile env-check run --rm env-check
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

# A safety net against a slip, not a security barrier: `SET default_transaction_read_only = off`
# lifts it. For looking, not editing.
# Open a read-only psql shell on the database: every transaction refuses to write
psql-ro:
    {{ compose }} exec -e PGOPTIONS="-c default_transaction_read_only=on" postgres psql -U ${POSTGRES_USER:-armurier} -d ${POSTGRES_DB:-armurier_prod}

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

# Takes a fresh dump, restores it into a throwaway database inside the backup
# container and compares row counts with the live one, which it only reads.
# Restore drill, harmless to prod: `just restore-drill <age key file>`
restore-drill key:
    #!/usr/bin/env bash
    set -euo pipefail
    [ -r "{{ key }}" ] || { echo "No readable age private key at {{ key }}"; exit 1; }
    {{ compose }} run --rm backup backup.sh
    {{ compose }} run --rm -v "$(realpath "{{ key }}"):/run/age-identity:ro" backup restore-drill.sh

# Adds and overwrites, never deletes. With a day, restores what that day's run
# saw deleted or overwritten.
# Copy backed-up objects back into the bucket: `just restore-objects [YYYY-MM-DD]`
restore-objects day="":
    {{ compose }} run --rm backup restore-objects.sh {{ day }}
