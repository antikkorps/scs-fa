/**
 * Same-origin check for CSRF defence on state-changing BFF requests.
 *
 * A cross-site browser request (the CSRF case, where the victim's cookies ride
 * along) always carries an `Origin` header pointing at the attacker's site, so
 * a present-but-mismatched Origin is rejected. A missing Origin is NOT a
 * cross-site browser attack (server-to-server / SSR internal calls, non-browser
 * clients) and is allowed — the SameSite=lax cookie and the auth requirement
 * still apply.
 */
export function originMatchesHost(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}
