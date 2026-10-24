import { randomBytes } from "node:crypto"
import { contentSecurityPolicy, withDocumentNonce } from "../utils/csp"

// Per-request nonce-based Content-Security-Policy for HTML documents.
//
// Nitro owns the CSP (not Caddy): a static reverse-proxy header can't carry the
// per-request nonce that must also appear on the inline <script> tags Nitro
// renders. The `render:html` hook stamps the nonce on those tags (never inside
// the app's own markup, see withDocumentNonce) and sets the matching header.
//
// Production only. Dev/HMR (Vite) injects eval'd inline scripts a strict
// script-src would break, so dev stays CSP-free as before.
export default defineNitroPlugin((nitroApp) => {
  if (import.meta.dev) return

  nitroApp.hooks.hook("render:html", (html, { event }) => {
    const nonce = randomBytes(16).toString("base64")
    // Nitro reads the parts back from this same object: update it in place.
    Object.assign(html, withDocumentNonce(html, nonce))
    setResponseHeader(event, "Content-Security-Policy", contentSecurityPolicy(nonce))
  })
})
