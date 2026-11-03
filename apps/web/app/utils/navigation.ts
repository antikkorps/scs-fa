/**
 * Sanitise a post-login `?redirect=` target so it can only point back into this
 * site. Rejects absolute URLs (`https://evil.com`), scheme-relative (`//evil`),
 * and the backslash trick (`/\evil`) that some browsers normalise to `//evil` —
 * any of which would turn our login flow into an open redirect. Returns the
 * fallback for anything that isn't a single-slash absolute path.
 */
export function safeInternalPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string") return fallback
  if (!/^\/(?![/\\])/.test(value)) return fallback
  return value
}

/** `?motif=` value telling the login and sign-up pages the visitor was adding to the cart. */
export const CART_REASON = "panier"

/**
 * Login URL for a visitor without an account who tried to add to the cart
 * (UX audit 2026-11-01, I3). The way back is the page itself with the item in
 * its query, so the page can add it once the visitor is signed in, whether they
 * logged in or created an account on the way.
 */
export function loginForCartPath(pagePath: string, intent: Record<string, string>): string {
  const back = `${pagePath}?${new URLSearchParams(intent).toString()}`
  return `/connexion?redirect=${encodeURIComponent(back)}&motif=${CART_REASON}`
}

/**
 * The part of the login / sign-up query worth carrying when the visitor moves
 * from one page to the other: a safe way back, and the known reason.
 */
export function authReturnQuery(query: Record<string, unknown>): Record<string, string> {
  const kept: Record<string, string> = {}
  const redirect = safeInternalPath(query.redirect, "")
  if (redirect) kept.redirect = redirect
  if (query.motif === CART_REASON) kept.motif = CART_REASON
  return kept
}
