// Postgres error codes the routes turn into HTTP answers.

const PG_UNIQUE_VIOLATION = "23505"

const hasPgCode = (error: unknown, code: string): boolean =>
  typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === code

/**
 * A unique constraint refused the write (a slug, an e-mail, a name already
 * taken). node-postgres raises it directly; once wrapped by Drizzle it sits on
 * `.cause`, so both levels are checked.
 */
export function isUniqueViolation(error: unknown): boolean {
  return hasPgCode(error, PG_UNIQUE_VIOLATION) || hasPgCode((error as { cause?: unknown })?.cause, PG_UNIQUE_VIOLATION)
}
