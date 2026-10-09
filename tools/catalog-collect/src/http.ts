// The only way a collector reaches a supplier's site. Politeness is not left to
// each adapter: robots.txt is honoured, requests to one host are spaced out
// (never faster than its Crawl-delay), 429/5xx back off, and every page is
// cached on disk — re-running a collection after a crash or a parser fix does
// not hit the supplier a second time.

import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { parseRobots, type RobotsRules } from "./robots.js"

export const USER_AGENT = "SCS-Firearm-CatalogCollect/1.0 (catalogue d'un revendeur agréé; contact via scs-firearm)"

export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`HTTP ${status} for ${url}`)
  }
}

/**
 * A page came back without the signed-in session a pro collection depends on
 * (expired, or the site logged us out). The run must stop: carrying on would
 * collect public pages as if they were pro ones.
 */
export class SessionLostError extends Error {
  constructor(readonly url: string) {
    super(`Pro session lost on ${url}: the collection stops, run it again to sign in anew`)
  }
}

export class DisallowedError extends Error {
  constructor(readonly url: string) {
    super(`robots.txt disallows ${url}`)
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface PoliteClientOptions {
  userAgent?: string
  /** Minimum spacing between two requests to the same host. */
  minIntervalMs?: number
  /** Where pages are cached; no cache when absent. */
  cacheDir?: string
  maxRetries?: number
  /**
   * Keep the cookies a site sets and send them back. Some supplier sites keep
   * a listing filter in the PHP session: the next page only makes sense with it.
   */
  cookies?: boolean
  /**
   * For a signed-in collection: every page fetched must pass this check (the
   * site still sees us signed in), or the request fails with
   * `SessionLostError` and nothing is cached.
   */
  acceptPage?: (html: string, url: string) => boolean
  fetch?: FetchLike
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  log?: (message: string) => void
}

const RETRYABLE = new Set([429, 500, 502, 503, 504])

export class PoliteClient {
  private readonly robots = new Map<string, Promise<RobotsRules>>()
  private readonly nextSlot = new Map<string, number>()
  private readonly jar = new Map<string, Map<string, string>>()
  private readonly opts: Required<Omit<PoliteClientOptions, "cacheDir" | "acceptPage">> &
    Pick<PoliteClientOptions, "cacheDir" | "acceptPage">

  constructor(options: PoliteClientOptions = {}) {
    this.opts = {
      userAgent: USER_AGENT,
      minIntervalMs: 1500,
      maxRetries: 3,
      cookies: false,
      fetch: (url, init) => fetch(url, init),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      log: () => {},
      ...options,
    }
  }

  private async rulesFor(origin: string): Promise<RobotsRules> {
    let rules = this.robots.get(origin)
    if (!rules) {
      rules = this.request(`${origin}/robots.txt`, { allowMissing: true }).then((text) =>
        parseRobots(text ?? "", this.opts.userAgent),
      )
      this.robots.set(origin, rules)
    }
    return rules
  }

  /** Wait for this host's next slot, then book the following one. */
  private async throttle(host: string, crawlDelaySeconds: number | null) {
    const interval = Math.max(this.opts.minIntervalMs, (crawlDelaySeconds ?? 0) * 1000)
    const now = this.opts.now()
    const slot = Math.max(now, this.nextSlot.get(host) ?? 0)
    this.nextSlot.set(host, slot + interval)
    if (slot > now) await this.opts.sleep(slot - now)
  }

  private async request(
    url: string,
    {
      allowMissing = false,
      form,
      redirects = 0,
    }: { allowMissing?: boolean; form?: Record<string, string>; redirects?: number } = {},
  ): Promise<string | null> {
    const { host } = new URL(url)
    // A sign-in is never replayed: a second wrong attempt is how an account
    // gets locked.
    const maxRetries = form ? 0 : this.opts.maxRetries
    const crawlDelay = url.endsWith("/robots.txt") ? null : (await this.rulesFor(new URL(url).origin)).crawlDelaySeconds
    for (let attempt = 0; ; attempt++) {
      await this.throttle(host, crawlDelay)
      let res: Response
      const jar = this.jar.get(host)
      const cookie = jar && jar.size > 0 ? [...jar].map(([k, v]) => `${k}=${v}`).join("; ") : undefined
      try {
        res = await this.opts.fetch(url, {
          headers: {
            "user-agent": this.opts.userAgent,
            "accept-language": "fr-FR,fr;q=0.9",
            ...(cookie ? { cookie } : {}),
            ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
          },
          ...(form ? { method: "POST", body: new URLSearchParams(form).toString() } : {}),
          // A sign-in sets its session cookie on the redirect itself, which
          // `fetch` would follow without letting us read it.
          redirect: form || redirects > 0 ? "manual" : "follow",
        })
      } catch (err) {
        if (attempt >= maxRetries) throw err
        this.opts.log(`network error on ${url}, retrying`)
        await this.opts.sleep(2 ** attempt * this.opts.minIntervalMs)
        continue
      }
      if (this.opts.cookies) this.keepCookies(host, res)
      const location = res.headers.get("location")
      if ((form || redirects > 0) && res.status >= 300 && res.status < 400 && location) {
        if (redirects >= 5) throw new HttpError(url, res.status)
        return this.request(new URL(location, url).toString(), { redirects: redirects + 1 })
      }
      if (res.ok) return res.text()
      if (allowMissing && (res.status === 404 || res.status === 410)) return null
      if (RETRYABLE.has(res.status) && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after"))
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 5000
        this.opts.log(`HTTP ${res.status} on ${url}, waiting ${Math.round(wait / 1000)} s`)
        await this.opts.sleep(wait)
        continue
      }
      throw new HttpError(url, res.status)
    }
  }

  private keepCookies(host: string, res: Response) {
    for (const header of res.headers.getSetCookie()) {
      const [pair] = header.split(";")
      const eq = pair?.indexOf("=") ?? -1
      if (!pair || eq <= 0) continue
      const jar = this.jar.get(host) ?? new Map<string, string>()
      jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
      this.jar.set(host, jar)
    }
  }

  private cachePath(url: string): string | null {
    if (!this.opts.cacheDir) return null
    return join(this.opts.cacheDir, `${createHash("sha256").update(url).digest("hex")}.html`)
  }

  /**
   * GET a page as text: from the disk cache when possible, politely otherwise.
   * `cache: false` for pages whose content depends on the session.
   */
  async get(url: string, { cache = true } = {}): Promise<string> {
    const cached = cache ? this.cachePath(url) : null
    if (cached) {
      const hit = await readFile(cached, "utf8").catch(() => null)
      if (hit !== null) return hit
    }
    const parsed = new URL(url)
    const rules = await this.rulesFor(parsed.origin)
    if (!rules.isAllowed(parsed.pathname + parsed.search)) throw new DisallowedError(url)
    const text = (await this.request(url)) as string
    if (this.opts.acceptPage && !this.opts.acceptPage(text, url)) throw new SessionLostError(url)
    if (cached && this.opts.cacheDir) {
      await mkdir(this.opts.cacheDir, { recursive: true })
      await writeFile(cached, text, "utf8")
    }
    return text
  }

  /**
   * POST a form (a sign-in) and return the page it lands on. Never cached,
   * never retried; the fields are not logged anywhere.
   */
  async postForm(url: string, fields: Record<string, string>): Promise<string> {
    const parsed = new URL(url)
    const rules = await this.rulesFor(parsed.origin)
    if (!rules.isAllowed(parsed.pathname + parsed.search)) throw new DisallowedError(url)
    return (await this.request(url, { form: fields })) as string
  }

  /** The sitemaps a host declares in its robots.txt. */
  async declaredSitemaps(origin: string): Promise<string[]> {
    return (await this.rulesFor(origin)).sitemaps
  }
}
