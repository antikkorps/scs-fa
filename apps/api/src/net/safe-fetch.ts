// Outbound HTTP GET for URLs that come from outside — today, the image URLs of
// an imported supplier catalogue (story 12.2).
//
// Letting a server fetch an arbitrary URL is a Server-Side Request Forgery
// hazard: `http://169.254.169.254/` is the cloud metadata endpoint,
// `http://localhost:5432` the database. The guard therefore checks the address
// the socket ACTUALLY connects to (through the `lookup` hook), not the
// hostname: a DNS record that points at 10.0.0.1, or that changes between a
// check and the connection (DNS rebinding), is refused all the same. Every
// redirect hop goes through the same guard.

import { lookup as dnsLookup, type LookupAddress } from "node:dns"
import http from "node:http"
import https from "node:https"
import { BlockList, isIP, type LookupFunction } from "node:net"

export class SafeFetchError extends Error {}

const blocked = new BlockList()
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const) {
  blocked.addSubnet(net, prefix, "ipv4")
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96], // NAT64 — maps onto IPv4, private ranges included
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(net, prefix, "ipv6")
}

/** True when an IP literal is a routable public address. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) return !blocked.check(ip, "ipv4")
  if (family === 6) {
    // An IPv4-mapped IPv6 address (::ffff:10.0.0.1) is judged as the IPv4 it is.
    const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped?.[1]) return !blocked.check(mapped[1], "ipv4")
    return !blocked.check(ip, "ipv6")
  }
  return false
}

export interface SafeGetOptions {
  maxBytes?: number
  timeoutMs?: number
  maxRedirects?: number
  /** Replaces the public-address check. Tests only — to reach a local server. */
  isAllowedAddress?: (ip: string) => boolean
  userAgent?: string
}

export interface SafeGetResponse {
  body: Buffer
  contentType: string | null
  finalUrl: string
}

const DEFAULTS = { maxBytes: 30 * 1024 * 1024, timeoutMs: 20_000, maxRedirects: 3 }

function guardedLookup(isAllowed: (ip: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, "", 0)
      const list = addresses as LookupAddress[]
      // Every record must be acceptable: connecting to "the first public one"
      // would still let a mixed record set steer us inward on a retry.
      const refused = list.find((a) => !isAllowed(a.address))
      if (refused || list.length === 0) {
        return callback(new SafeFetchError(`Refused address for ${hostname}`), "", 0)
      }
      if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list)
      const [first] = list as [LookupAddress]
      callback(null, first.address, first.family)
    })
  }
}

function checkUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new SafeFetchError("Invalid URL")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SafeFetchError(`Refused scheme ${url.protocol}`)
  if (url.username || url.password) throw new SafeFetchError("Refused URL with credentials")
  return url
}

function getOnce(url: URL, opts: Required<Omit<SafeGetOptions, "isAllowedAddress" | "userAgent">> & SafeGetOptions) {
  const isAllowed = opts.isAllowedAddress ?? isPublicAddress
  // An IP literal never goes through `lookup`: check it here.
  const host = url.hostname.replace(/^\[|\]$/g, "")
  if (isIP(host) && !isAllowed(host)) return Promise.reject(new SafeFetchError(`Refused address ${host}`))

  return new Promise<{ status: number; location?: string; body?: Buffer; contentType: string | null }>(
    (resolve, reject) => {
      const client = url.protocol === "https:" ? https : http
      const req = client.get(
        url,
        {
          lookup: guardedLookup(isAllowed),
          timeout: opts.timeoutMs,
          headers: { "user-agent": opts.userAgent ?? "SCS-Firearm-CatalogImport/1.0", accept: "image/*,*/*;q=0.5" },
        },
        (res) => {
          const status = res.statusCode ?? 0
          const contentType = res.headers["content-type"]?.split(";")[0]?.trim() ?? null
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume()
            return resolve({ status, location: res.headers.location, contentType })
          }
          if (status < 200 || status >= 300) {
            res.resume()
            return reject(new SafeFetchError(`HTTP ${status}`))
          }
          const declared = Number(res.headers["content-length"])
          if (Number.isFinite(declared) && declared > opts.maxBytes) {
            req.destroy()
            return reject(new SafeFetchError("Response too large"))
          }
          const chunks: Buffer[] = []
          let size = 0
          res.on("data", (chunk: Buffer) => {
            size += chunk.length
            if (size > opts.maxBytes) {
              req.destroy()
              reject(new SafeFetchError("Response too large"))
            } else chunks.push(chunk)
          })
          res.on("end", () => resolve({ status, body: Buffer.concat(chunks), contentType }))
          res.on("error", reject)
        },
      )
      req.on("timeout", () => req.destroy(new SafeFetchError("Request timed out")))
      req.on("error", (err) => reject(err instanceof SafeFetchError ? err : new SafeFetchError(err.message)))
    },
  )
}

/** GET a public URL, following a bounded number of redirects, with a size cap and a timeout. */
export async function safeGet(rawUrl: string, options: SafeGetOptions = {}): Promise<SafeGetResponse> {
  const opts = { ...DEFAULTS, ...options }
  let url = checkUrl(rawUrl)
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const res = await getOnce(url, opts)
    if (res.location === undefined) {
      return { body: res.body ?? Buffer.alloc(0), contentType: res.contentType, finalUrl: url.toString() }
    }
    url = checkUrl(new URL(res.location, url).toString())
  }
  throw new SafeFetchError("Too many redirects")
}
