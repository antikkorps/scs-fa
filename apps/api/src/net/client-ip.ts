import { timingSafeEqual } from "node:crypto"
import { BlockList, isIP } from "node:net"
import type { FastifyRequest } from "fastify"

/**
 * Who is the client? (story 9.6)
 *
 * The API is never reached directly: every request comes through Caddy (the
 * only published port) or from the Nuxt server, both on the private Docker
 * network. Caddy resolves the real client IP (Cloudflare ranges trusted,
 * `CF-Connecting-IP`) and OVERWRITES `X-Forwarded-For` with that single value;
 * the Nuxt server does the same with the visitor it renders for.
 *
 * So exactly one hop is trusted — the direct peer — and only when it is on a
 * private network. The previous `trustProxy: true` trusted the whole chain and
 * returned its left-most entry, which the client itself writes: anyone could
 * pick a fresh IP per request and walk past the rate limiter.
 */
const PRIVATE = new BlockList()
PRIVATE.addSubnet("127.0.0.0", 8, "ipv4")
PRIVATE.addSubnet("10.0.0.0", 8, "ipv4")
PRIVATE.addSubnet("172.16.0.0", 12, "ipv4")
PRIVATE.addSubnet("192.168.0.0", 16, "ipv4")
PRIVATE.addAddress("::1", "ipv6")
PRIVATE.addSubnet("fc00::", 7, "ipv6")

export function isPrivateAddress(address: string): boolean {
  // An IPv4 peer on a dual-stack socket shows up as ::ffff:a.b.c.d.
  const ip = address.startsWith("::ffff:") ? address.slice(7) : address
  const family = isIP(ip)
  if (family === 0) return false
  return PRIVATE.check(ip, family === 4 ? "ipv4" : "ipv6")
}

/** Fastify `trustProxy`: trust the direct peer, if private — and nothing beyond it. */
export function trustDirectPrivatePeer(address: string, hop: number): boolean {
  return hop === 0 && isPrivateAddress(address)
}

/** Whether the request carries the secret shared with the Nuxt server. Constant-time. */
export function isInternalCall(request: FastifyRequest, secret: string | undefined): boolean {
  if (!secret) return false
  const sent = request.headers["x-internal-auth"]
  if (typeof sent !== "string") return false
  const a = Buffer.from(sent)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}
