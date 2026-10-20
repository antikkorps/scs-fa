// Story 12.8a — which accounts confirm their login with an e-mailed code.
//
// None yet: the pro accounts of 12.8b will (a code at every login, so an agent
// cannot hand their access to someone outside). Admins were going to use it
// until the app-based second factor of 12.8e; decided otherwise on 2026-10-20 —
// admins get the 7-day session cap only (see tokens.ts).
export async function requiresLoginCode(_user: { id: string; role: string }): Promise<boolean> {
  return false
}
