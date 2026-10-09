import { execSync } from "node:child_process"

// Test database helpers shared by the global setup and the suites that need a
// database of their own (e.g. the seed CLI, which must start from empty).

export const DB_CONTAINER = process.env.TEST_DB_CONTAINER ?? "armurier_postgres_dev"
export const DB_USER = process.env.TEST_DB_USER ?? "armurier"
export const DB_PASSWORD = process.env.TEST_DB_PASSWORD ?? "armurier_dev_password"
export const TEST_DB = process.env.TEST_DB_NAME ?? "armurier_test"
// A dedicated var (not DATABASE_URL) so a stray DATABASE_URL in the shell can't
// silently redirect the suite at the dev database — isolation is the whole point.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? `postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5435/${TEST_DB}`

/** Run a shell command; on failure, throw with its output so the cause is visible. */
export function runCommand(command: string): void {
  try {
    execSync(command, { stdio: ["ignore", "pipe", "pipe"] })
  } catch (error) {
    const failure = error as { stdout?: Buffer; stderr?: Buffer; message: string }
    const detail = `${failure.stdout?.toString() ?? ""}${failure.stderr?.toString() ?? ""}`.trim()
    throw new Error(`Test DB setup step failed: ${command}\n${detail || failure.message}`)
  }
}

/** The same server and credentials, another database. */
export function withDatabaseName(url: string, database: string): string {
  const target = new URL(url)
  target.pathname = `/${database}`
  return target.toString()
}

/**
 * Build the schema from the migration files. `DATABASE_URL` is passed inline
 * because drizzle.config.ts reads it from the environment, and dotenv won't
 * override an already-set value — so this targets the given database even
 * though apps/api/.env points at dev.
 */
export function migrateDatabase(url: string): void {
  runCommand(`DATABASE_URL=${JSON.stringify(url)} pnpm exec drizzle-kit migrate`)
}
