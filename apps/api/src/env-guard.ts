// Story 12.9b (security audit, high 2) — a production server must never run on
// the sample values of the committed `.env.prod.example` / `.env.example`. They
// pass the schema (a "CHANGE-ME…" JWT secret is long enough), yet anyone who has
// read the repository could forge an admin token with one.
//
// Pure on purpose: env.ts calls it on the parsed environment at startup, and
// the whole production `.env` reaches the API container (Postgres, Umami and the
// admin seed included), so one check covers every secret of the deployment.

// The placeholders the examples use: CHANGE-ME, change-me, ChangeMe, replace-me, your-…
const SAMPLE_PLACEHOLDER = /change-?me|replace-?me|your-/i

// Sample account of the examples: customers would wire their money to it.
const SAMPLE_IBAN = "FR7630006000011234567890189"

// Variables that hold a secret, by name. DATABASE_URL carries the Postgres password.
const SECRET_NAME = /SECRET|PASSWORD|PASS$|_KEY$|_KEY_|TOKEN|^DATABASE_URL$/

export function isSampleValue(value: string): boolean {
  return SAMPLE_PLACEHOLDER.test(value)
}

/**
 * The variables of a production environment that still hold a sample value —
 * by name only, never the value, which may be a real secret mistyped.
 */
export function sampleValueProblems(environment: Record<string, string | undefined>): string[] {
  const problems = Object.entries(environment)
    .filter(([name, value]) => SECRET_NAME.test(name) && value && isSampleValue(value))
    .map(([name]) => name)

  if (environment.VIREMENT_IBAN?.replace(/\s/g, "").toUpperCase() === SAMPLE_IBAN) problems.push("VIREMENT_IBAN")

  const { JWT_SECRET, JWT_REFRESH_SECRET } = environment
  if (JWT_SECRET && JWT_SECRET === JWT_REFRESH_SECRET && !problems.includes("JWT_SECRET")) {
    problems.push("JWT_REFRESH_SECRET (same as JWT_SECRET)")
  }
  return problems
}
