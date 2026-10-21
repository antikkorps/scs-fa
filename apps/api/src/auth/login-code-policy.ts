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
