import {
  DB_CONTAINER,
  DB_PASSWORD,
  DB_USER,
  migrateDatabase,
  runCommand,
  TEST_DATABASE_URL,
  TEST_DB,
} from "./database.js"

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

function psql(sql: string, database = "postgres"): void {
  runCommand(
    `docker exec -e PGPASSWORD=${DB_PASSWORD} ${DB_CONTAINER} ` +
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

  migrateDatabase(TEST_DATABASE_URL)

  // Reference data plus the demo catalogue: several suites read the seeded
  // artworks, products and posts (sitemap, public artwork pages…).
  runCommand(
    `DATABASE_URL=${JSON.stringify(TEST_DATABASE_URL)} ` +
      `STORAGE_DRIVER=memory NODE_ENV=test pnpm exec tsx src/db/seed-cli.ts --demo`,
  )
}
