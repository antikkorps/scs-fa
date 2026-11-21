// Postgres error codes the routes turn into HTTP answers.

const PG_UNIQUE_VIOLATION = "23505"
// ON DELETE RESTRICT raises its own code, not the generic 23503 of NO ACTION.
const PG_RESTRICT_VIOLATION = "23001"

type PgError = { code?: unknown; constraint?: unknown }

/** node-postgres raises its error directly; once wrapped by Drizzle it sits on `.cause`. */
function pgErrorOf(error: unknown, code: string): PgError | null {
  for (const candidate of [error, (error as { cause?: unknown })?.cause]) {
    if (typeof candidate === "object" && candidate !== null && (candidate as PgError).code === code) {
      return candidate as PgError
    }
  }
  return null
}

/**
 * A unique constraint refused the write (a slug, an e-mail, a name already
 * taken) — that constraint only, when one is named.
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const pgError = pgErrorOf(error, PG_UNIQUE_VIOLATION)
  if (!pgError) return false
  return constraint === undefined || pgError.constraint === constraint
}

/** A RESTRICT foreign key refused a deletion: something still points at the row. */
export function isRestrictViolation(error: unknown, constraint: string): boolean {
  return pgErrorOf(error, PG_RESTRICT_VIOLATION)?.constraint === constraint
}
