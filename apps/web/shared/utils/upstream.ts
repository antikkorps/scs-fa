// Shared by the SSR fetcher (app/plugins/api-fetch.ts) and the server routes
// (server/utils/upstream.ts): the one definition of what an internal call carries.

/**
 * Headers the Nuxt server sends when it calls the API for a visitor (story 9.6).
 *
 * Without them every server-rendered page, BFF call and feed was attributed to
 * the Nuxt server's own address: the whole site shared ONE rate-limit budget
 * (a crawler, or a handful of visitors, exhausted it and pages turned into
 * errors), and login throttling, audit logs and newsletter consent proofs all
 * recorded the same IP.
 *
 * `X-Forwarded-For` carries the visitor's IP. It is taken from Caddy's own
 * `X-Forwarded-For`, which Caddy overwrites with the real client IP — trusting
 * it is sound only because this server is reachable through Caddy alone. The
 * secret marks the call as internal, which earns a larger rate-limit budget.
 */
export function upstreamHeaders(clientIp: string | undefined, secret: string): Record<string, string> {
  return {
    ...(clientIp ? { "x-forwarded-for": clientIp } : {}),
    ...(secret ? { "x-internal-auth": secret } : {}),
  }
}
