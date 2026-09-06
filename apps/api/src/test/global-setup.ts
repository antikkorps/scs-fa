import { execSync } from "node:child_process"

// Vitest global setup: provision a dedicated, throwaway test database so the
// suite never touches the dev database (several tests assert on *global* state —
// e.g. the SLA breach check emails every admin — and used to wipe the seeded
// demo admin on every run). The schema is built by **applying the Drizzle
// migrations** (`drizzle/`, the single source of truth), then reference data is
// seeded. Recreated from scratch each run, so the suite always starts pristine.
//
// Migrations run on BOTH paths — local provisioning and CI — so the test schema
// is produced exactly the way dev and prod are. That is the point of the
// baseline: there is no second way to build the schema, hence nothing to drift.
// (Before the baseline this cloned the dev database via `pg_dump -s`, which made
// the suite depend on whatever state the local dev DB happened to be in.)
//
// All knobs are env-overridable for CI (where the test DB already exists as a
// service container): set TEST_DATABASE_URL + TEST_DB_SKIP_PROVISION=true to
// skip the docker drop/create and migrate + seed the existing database.

const CONTAINER = process.env.TEST_DB_CONTAINER ?? "armurier_postgres_dev"
const DB_USER = process.env.TEST_DB_USER ?? "armurier"
const DB_PASSWORD = process.env.TEST_DB_PASSWORD ?? "armurier_dev_password"
const TEST_DB = process.env.TEST_DB_NAME ?? "armurier_test"
// A dedicated var (not DATABASE_URL) so a stray DATABASE_URL in the shell can't
// silently redirect the suite at the dev database — isolation is the whole point.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? `postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5435/${TEST_DB}`

function run(command: string): void {
  try {
    execSync(command, { stdio: ["ignore", "pipe", "pipe"] })
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; message: string }
    const detail = `${e.stdout?.toString() ?? ""}${e.stderr?.toString() ?? ""}`.trim()
    throw new Error(`Test DB setup step failed: ${command}\n${detail || e.message}`)
  }
}

function psql(sql: string, database = "postgres"): void {
  run(
    `docker exec -e PGPASSWORD=${DB_PASSWORD} ${CONTAINER} ` +
      `psql -U ${DB_USER} -d ${database} -v ON_ERROR_STOP=1 -c ${JSON.stringify(sql)}`,
  )
}

export default function setup(): void {
  if (process.env.TEST_DB_SKIP_PROVISION !== "true") {
    // Drop + recreate a pristine database. WITH (FORCE) closes any lingering
    // session so the drop can't be blocked by an idle connection.
    psql(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`)
    psql(`CREATE DATABASE ${TEST_DB}`)
  }

  // Build the schema from the migration files. `DATABASE_URL` is passed inline
  // because drizzle.config.ts reads it from the environment, and dotenv won't
  // override an already-set value — so this targets the test DB even though
  // apps/api/.env points at dev.
  run(`DATABASE_URL=${JSON.stringify(TEST_DATABASE_URL)} pnpm exec drizzle-kit migrate`)

  // Seed the reference data the suites rely on (legal + product categories, …).
  run(
    `DATABASE_URL=${JSON.stringify(TEST_DATABASE_URL)} ` +
      `STORAGE_DRIVER=memory NODE_ENV=test pnpm exec tsx src/db/seed-cli.ts`,
  )
}
