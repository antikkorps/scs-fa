#!/bin/sh
# Runs `just db-roles` then `just migrate` exactly as production does — the
# compose services, the migrate image built from the API Dockerfile — against a
# throwaway database, and checks every committed migration got applied.
# The CI applies migrations on the host, so this is the only check of the
# deploy path. Usage, from the repo root, with Docker running: `just check-migrate`.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT=scs-check-migrate
WORK="$(mktemp -d)"

# Production logs to journald, which Docker Desktop and most CI hosts lack:
# reset the logging of the three services involved to Docker's default.
cat >"$WORK/logging.override.yml" <<'YAML'
services:
  postgres: { logging: !reset null }
  db-roles: { logging: !reset null }
  migrate: { logging: !reset null }
YAML

# The example env holds every variable compose interpolates; its sample secrets
# are fine for a database that lives only for this check.
compose() {
  docker compose -p "$PROJECT" -f "$ROOT/docker-compose.prod.yml" -f "$WORK/logging.override.yml" \
    --env-file "$ROOT/.env.prod.example" --profile db-roles --profile migrate "$@"
}
cleanup() {
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
compose down -v --remove-orphans >/dev/null 2>&1 || true

echo "Migration check (docker-compose.prod.yml)"
compose run --rm db-roles
compose run --rm --build migrate

applied="$(compose exec -T postgres psql -U armurier -d armurier_prod -tAc \
  'select count(*) from drizzle.__drizzle_migrations')"
expected="$(find "$ROOT/apps/api/drizzle" -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')"

if [ "$applied" = "$expected" ]; then
  echo "  ok   $applied/$expected migrations applied by the migrate service"
else
  echo "  FAIL $applied/$expected migrations applied by the migrate service"
  exit 1
fi
