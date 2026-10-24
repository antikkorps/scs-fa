import { BlockList, isIP } from "node:net"
import type { FastifyRequest } from "fastify"
import { matchesSecret } from "./shared-secret.js"

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

/** The 16-bit groups of an IPv6 address, the `::` run expanded. */
function ipv6Groups(ip: string): string[] {
  const [head, tail] = ip.split("::")
  const headGroups = head ? head.split(":") : []
  const tailGroups = tail ? tail.split(":") : []
  // An embedded IPv4 tail (::ffff:1.2.3.4, 64:ff9b::1.2.3.4) fills two groups.
  const width = (groups: string[]) => groups.reduce((sum, group) => sum + (group.includes(".") ? 2 : 1), 0)
  const missing = tail === undefined ? 0 : 8 - width(headGroups) - width(tailGroups)
  return [...headGroups, ...Array<string>(missing).fill("0"), ...tailGroups]
}

/**
 * Whose budget a request spends (story 12.9f). An IPv4 address is one
 * subscriber; on IPv6 a subscriber gets a whole /64 and can pick any address
 * in it, so the /64 prefix is the key — else one line has unlimited budgets.
 */
export function rateLimitKey(address: string): string {
  const ip = address.startsWith("::ffff:") ? address.slice(7) : address
  if (isIP(ip) !== 6) return ip
  const prefix = ipv6Groups(ip.split("%")[0])
    .slice(0, 4)
    .map((group) => Number.parseInt(group, 16).toString(16))
  return `${prefix.join(":")}::/64`
}

/** Fastify `trustProxy`: trust the direct peer, if private — and nothing beyond it. */
export function trustDirectPrivatePeer(address: string, hop: number): boolean {
  return hop === 0 && isPrivateAddress(address)
}

/** Whether the request carries the secret shared with the Nuxt server. Constant-time. */
export function isInternalCall(request: FastifyRequest, secret: string | undefined): boolean {
  return matchesSecret(request.headers["x-internal-auth"], secret)
}
