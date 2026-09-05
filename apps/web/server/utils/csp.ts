// Content-Security-Policy for the SSR HTML documents, built per request with a
// fresh nonce so inline scripts (Nuxt's hydration payload, our JSON-LD blocks)
// are allowed without `'unsafe-inline'`. Applied by server/plugins/csp.ts.

const STRIPE_JS = "https://js.stripe.com"
const STRIPE_API = "https://api.stripe.com"
const STRIPE_HOOKS = "https://hooks.stripe.com"
const STRIPE_NETWORK = "https://m.stripe.network"
const GOOGLE_FONTS_CSS = "https://fonts.googleapis.com"
const GOOGLE_FONTS_FILES = "https://fonts.gstatic.com"

/** The CSP header value for an HTML response using the given per-request nonce. */
export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    // Inline scripts are allowed only via the per-request nonce (no
    // 'unsafe-inline'); Stripe.js loads from its own origin.
    `script-src 'self' 'nonce-${nonce}' ${STRIPE_JS}`,
    // Styles keep 'unsafe-inline': PrimeVue injects <style> at runtime on the
    // client, which a server-side nonce cannot cover. Revisit with PrimeVue's
    // `csp.nonce` option to drop this too.
    `style-src 'self' 'unsafe-inline' ${GOOGLE_FONTS_CSS}`,
    `font-src 'self' ${GOOGLE_FONTS_FILES}`,
    "img-src 'self' data: https:",
    // Stripe Elements calls the API + fraud-signal endpoint.
    `connect-src 'self' ${STRIPE_API} ${STRIPE_NETWORK}`,
    // Stripe Elements render inside iframes from these origins.
    `frame-src ${STRIPE_JS} ${STRIPE_HOOKS}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ")
}

/**
 * Add `nonce="…"` to every inline `<script>` in the given HTML fragments so it
 * satisfies the nonce-based script-src. External scripts (with `src`) already
 * match the origin allowlist and JSON-LD data blocks are inert, but tagging
 * them too is harmless and keeps the rule simple. Idempotent: a tag that
 * already carries a nonce is left untouched.
 */
export function withScriptNonce(fragments: string[], nonce: string): string[] {
  return fragments.map((f) => f.replace(/<script(?![^>]*\snonce=)/gi, `<script nonce="${nonce}"`))
}
