#!/bin/sh
# Checks infra/postgres/roles.sql against a throwaway Postgres (story 12.9f):
# applies it twice (it must be re-runnable), runs the real Drizzle migrations
# as the owner role, then asserts what each role may and may not do.
# Usage, from the repo root, with Docker running: `just check-db-roles`.
set -eu

CONTAINER=scs_roles_check
PORT=55432
DB=armurier_prod
SUPERUSER=armurier
IMAGE=postgres:18-alpine
ROLES_SQL="$(cd "$(dirname "$0")" && pwd)/roles.sql"

failures=0
pass() { echo "  ok   $*"; }
fail() { echo "  FAIL $*"; failures=$((failures + 1)); }

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

# Runs SQL inside the container as a given role (password = role name + "_pw").
as_role() {
  role="$1"
  shift
  docker exec -e PGPASSWORD="${role}_pw" "$CONTAINER" \
    psql -h localhost -U "$role" -d "$DB" -v ON_ERROR_STOP=1 -tAq "$@"
}
allowed() {
  if as_role "$1" -c "$2" >/dev/null 2>&1; then pass "$1 may: $2"; else fail "$1 should be allowed: $2"; fi
}
refused() {
  if as_role "$1" -c "$2" >/dev/null 2>&1; then fail "$1 should be refused: $2"; else pass "$1 may not: $2"; fi
}
apply_roles() {
  docker exec -i "$CONTAINER" psql -h localhost -U "$SUPERUSER" -d "$DB" -q \
    -v db="$DB" \
    -v owner_password=scs_owner_pw -v app_password=scs_app_pw -v backup_password=scs_backup_pw \
    < "$ROLES_SQL"
}

echo "[check-roles] starting ${IMAGE}"
docker run -d --name "$CONTAINER" -p "${PORT}:5432" \
  -e POSTGRES_USER="$SUPERUSER" -e POSTGRES_PASSWORD="${SUPERUSER}_pw" -e POSTGRES_DB="$DB" \
  "$IMAGE" >/dev/null
until docker exec "$CONTAINER" pg_isready -h localhost -U "$SUPERUSER" -d "$DB" >/dev/null 2>&1; do sleep 1; done

# A database that predates the roles: one table and one enum owned by the superuser.
docker exec "$CONTAINER" psql -h localhost -U "$SUPERUSER" -d "$DB" -q \
  -c "CREATE TYPE legacy_kind AS ENUM ('a', 'b')" \
  -c "CREATE TABLE legacy (id serial PRIMARY KEY, kind legacy_kind)"

echo "[check-roles] applying roles.sql twice"
apply_roles
apply_roles

echo "[check-roles] running the Drizzle migrations as scs_owner"
(cd "$(dirname "$0")/../.." &&
  DATABASE_URL="postgresql://scs_owner:scs_owner_pw@localhost:${PORT}/${DB}" \
    pnpm --filter @armurier/api exec drizzle-kit migrate >/dev/null)

echo "[check-roles] assertions"
for role in scs_owner scs_app scs_backup; do
  if [ "$(as_role "$role" -c "SELECT rolsuper OR rolcreaterole OR rolcreatedb FROM pg_roles WHERE rolname = current_user")" = "f" ]; then
    pass "$role has no superuser, createrole or createdb"
  else
    fail "$role must not be superuser, createrole or createdb"
  fi
done

foreign_owned="$(as_role scs_owner -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public', 'drizzle') AND pg_get_userbyid(c.relowner) <> 'scs_owner'")"
if [ "$foreign_owned" = "0" ]; then pass "scs_owner owns every relation, older ones included"; else fail "${foreign_owned} relations not owned by scs_owner"; fi

allowed scs_app "SELECT count(*) FROM users"
allowed scs_app "INSERT INTO legacy (kind) VALUES ('a')"
allowed scs_app "UPDATE legacy SET kind = 'b'"
allowed scs_app "DELETE FROM legacy"
refused scs_app "CREATE TABLE intruder (id int)"
refused scs_app "DROP TABLE legacy"
refused scs_app "ALTER TABLE users ADD COLUMN intruder int"
refused scs_app "TRUNCATE legacy"
refused scs_app "SELECT count(*) FROM drizzle.__drizzle_migrations"

allowed scs_backup "SELECT count(*) FROM users"
allowed scs_backup "SELECT count(*) FROM drizzle.__drizzle_migrations"
refused scs_backup "INSERT INTO legacy (kind) VALUES ('a')"
refused scs_backup "DELETE FROM legacy"
if docker exec -e PGPASSWORD=scs_backup_pw "$CONTAINER" pg_dump -h localhost -U scs_backup -d "$DB" -Fc -f /tmp/check.dump 2>/dev/null; then
  pass "scs_backup can pg_dump the database"
else
  fail "scs_backup should be able to pg_dump the database"
fi

# The API's startup guard (apps/api/src/db/role-guard.ts) accepts scs_app only.
guard_problems() {
  (cd "$(dirname "$0")/../../apps/api" &&
    ROLE_URL="postgresql://$1:$1_pw@localhost:${PORT}/${DB}" node_modules/.bin/tsx -e '
      import pg from "pg"
      import { databaseRoleProblems } from "./src/db/role-guard.ts"
      const main = async () => {
        const client = new pg.Client({ connectionString: process.env.ROLE_URL })
        await client.connect()
        console.log((await databaseRoleProblems(client)).length)
        await client.end()
      }
      main()
    ' 2>/dev/null)
}
# The guard prints its problem count: a crash prints nothing and fails both checks.
case "$(guard_problems scs_app)" in
  0) pass "the API guard accepts scs_app" ;;
  *) fail "the API guard should accept scs_app" ;;
esac
case "$(guard_problems scs_owner)" in
  [1-9]) pass "the API guard refuses scs_owner" ;;
  *) fail "the API guard should refuse scs_owner" ;;
esac

# Any other login role (Umami's, for one) may not even connect to the shop's database.
docker exec "$CONTAINER" psql -h localhost -U "$SUPERUSER" -d "$DB" -q -c "CREATE ROLE stranger LOGIN PASSWORD 'stranger_pw'"
refused stranger "SELECT 1"

if [ "$failures" -gt 0 ]; then
  echo "[check-roles] ${failures} check(s) failed"
  exit 1
fi
echo "[check-roles] all checks passed"
