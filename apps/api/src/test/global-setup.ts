import { execSync } from "node:child_process"

// Vitest global setup: provision a dedicated, throwaway test database so the
// suite never touches the dev database (several tests assert on *global* state —
// e.g. the SLA breach check emails every admin — and used to wipe the seeded
// demo admin on every run). The schema is cloned from the dev database, which is
// the source of truth (no migration baseline yet), then reference data is
// seeded. Recreated from scratch each run, so the suite always starts pristine.
//
// All knobs are env-overridable for CI (where a real test DB may already exist):
// set DATABASE_URL + TEST_DB_SKIP_PROVISION=true to skip the docker provisioning
// and just seed an existing database.

const CONTAINER = process.env.TEST_DB_CONTAINER ?? "armurier_postgres_dev"
const DB_USER = process.env.TEST_DB_USER ?? "armurier"
const DB_PASSWORD = process.env.TEST_DB_PASSWORD ?? "armurier_dev_password"
const TEST_DB = process.env.TEST_DB_NAME ?? "armurier_test"
const SOURCE_DB = process.env.TEST_DB_SOURCE ?? "armurier_dev"
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
    // Drop + recreate a pristine database, then clone the dev schema into it
    // (structure only — no dev rows). WITH (FORCE) closes any lingering session.
    psql(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`)
    psql(`CREATE DATABASE ${TEST_DB}`)
    run(
      `docker exec -e PGPASSWORD=${DB_PASSWORD} ${CONTAINER} ` +
        `sh -c "pg_dump -U ${DB_USER} -s ${SOURCE_DB} | psql -U ${DB_USER} -d ${TEST_DB} -q -v ON_ERROR_STOP=1"`,
    )
  }

  // Seed the reference data the suites rely on (legal + product categories, …).
  // dotenv won't override an already-set DATABASE_URL, so the seed targets the
  // test DB even though apps/api/.env points at dev.
  run(
    `DATABASE_URL=${JSON.stringify(TEST_DATABASE_URL)} ` +
      `STORAGE_DRIVER=memory NODE_ENV=test pnpm exec tsx src/db/seed-cli.ts`,
  )
}
