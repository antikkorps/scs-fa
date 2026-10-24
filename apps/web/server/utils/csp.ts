// Content-Security-Policy for the SSR HTML documents, built per request with a
// fresh nonce so inline scripts (Nuxt's hydration payload, our JSON-LD blocks)
// are allowed without `'unsafe-inline'`. Applied by server/plugins/csp.ts.

const STRIPE_JS = "https://js.stripe.com"
const STRIPE_API = "https://api.stripe.com"
const STRIPE_HOOKS = "https://hooks.stripe.com"
const STRIPE_NETWORK = "https://m.stripe.network"

/** The CSP header value for an HTML response using the given per-request nonce. */
export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    // Google's "strict CSP": a script runs if it carries the per-request nonce
    // or was loaded by one that does ('strict-dynamic' — Nuxt's lazy chunks,
    // Stripe.js and Umami are all inserted by our own code). A host allowlist
    // alone can be bypassed through any script an allowed origin serves, so
    // browsers that know 'strict-dynamic' ignore 'self' and the Stripe origin,
    // which only serve browsers that do not. 'unsafe-inline' is dropped by any
    // browser that knows nonces (CSP 2), 'strict-dynamic' or not: it only
    // reaches browsers older than nonces.
    `script-src 'nonce-${nonce}' 'strict-dynamic' 'self' ${STRIPE_JS} 'unsafe-inline'`,
    // Styles keep 'unsafe-inline': Nuxt inlines component CSS into <style>
    // blocks of the SSR document, and Vue `:style` bindings render `style`
    // attributes — which a nonce cannot cover at all.
    "style-src 'self' 'unsafe-inline'",
    // Fonts are self-hosted as of story 10.7, so no third-party origin needs
    // to be allowed here any more.
    "font-src 'self'",
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

// A `<link>` that fetches a script: Nuxt's module preloads and script prefetches.
const SCRIPT_LINK = /<link(?![^>]*\snonce=)(?=[^>]*\s(?:rel="modulepreload"|as="script"))/gi

/**
 * Add `nonce="…"` to every `<script>` in the given HTML fragments, and to every
 * `<link>` that fetches a script, so they satisfy the nonce-based script-src:
 * under 'strict-dynamic' a parser-inserted tag without the nonce is refused,
 * even from our own origin. JSON-LD data blocks are inert, but tagging them too
 * is harmless and keeps the rule simple. Idempotent: a tag that already carries
 * a nonce is left untouched.
 */
export function withScriptNonce(fragments: unknown[], nonce: string): string[] {
  // Modules do not all push strings: the PrimeVue module (since removed) pushed
  // empty ARRAYS into the head (story 9.6), which crashed every page in
  // production. Flattened and non-strings dropped — exactly what Nitro's own
  // join would have made of them, minus the crash — whatever module comes next.
  return fragments
    .flat(Number.POSITIVE_INFINITY)
    .filter((f): f is string => typeof f === "string")
    .map((f) =>
      f
        .replace(/<script(?![^>]*\snonce=)/gi, `<script nonce="${nonce}"`)
        .replace(SCRIPT_LINK, `<link nonce="${nonce}"`),
    )
}

/** The parts of a rendered document Nitro's `render:html` hook hands over. */
interface RenderedDocument {
  head: unknown[]
  bodyPrepend: unknown[]
  body: unknown[]
  bodyAppend: unknown[]
}

/**
 * Stamps the nonce on the scripts Nuxt renders around the app: the head (JSON-
 * LD, preloads) and the ends of the body (hydration payload, entry module).
 * Never on `body` itself, the app's own markup (story 12.9g): back-office rich
 * text reaches it through `v-html`, and a script slipped in there must stay
 * blocked rather than be vouched for.
 */
export function withDocumentNonce<Document extends RenderedDocument>(
  html: Document,
  nonce: string,
): Document & { head: string[]; bodyPrepend: string[]; bodyAppend: string[] } {
  return {
    ...html,
    head: withScriptNonce(html.head, nonce),
    bodyPrepend: withScriptNonce(html.bodyPrepend, nonce),
    bodyAppend: withScriptNonce(html.bodyAppend, nonce),
  }
}
