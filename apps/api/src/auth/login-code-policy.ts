// Story 12.8a — which accounts confirm their login with an e-mailed code.
//
// The members of an organisation (story 12.8b), whatever its status: a code at
// every login, so an agent cannot hand their access to someone outside.
// Admins were going to use it until the app-based second factor of 12.8e;
// decided otherwise on 2026-10-20 — admins get the 7-day session cap only (see
// tokens.ts).
export async function requiresLoginCode(user: { organisationId: string | null }): Promise<boolean> {
  return user.organisationId !== null
}

export type SecondFactor = "email_code" | "totp" | "totp_enrollment"

/**
 * Story 12.8e — what a login waits for after the right password: the app's
 * code once enabled (it replaces the mailed code for a pro, decision
 * 2026-10-25); its enrolment for an admin without it (mandatory); the mailed
 * code for an organisation's member; nothing for anyone else.
 */
export async function secondFactorFor(user: {
  role: string
  organisationId: string | null
  totpEnabledAt: Date | null
}): Promise<SecondFactor | null> {
  if (user.totpEnabledAt) return "totp"
  if (user.role === "admin") return "totp_enrollment"
  if (await requiresLoginCode(user)) return "email_code"
  return null
}
