import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { DisallowedError, HttpError, PoliteClient } from "./http.js"

type Route = string | { status: number; body?: string; headers?: Record<string, string> } | Error

function fakeSite(routes: Record<string, Route | Route[]>) {
  const calls: string[] = []
  const queues = new Map(Object.entries(routes).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]))
  const fetch = async (url: string) => {
    calls.push(url)
    const queue = queues.get(url)
    const next = (queue && queue.length > 1 ? queue.shift() : queue?.[0]) ?? { status: 404 }
    if (next instanceof Error) throw next
    const r = typeof next === "string" ? { status: 200, body: next } : next
    return new Response(r.body ?? "", { status: r.status, headers: r.headers })
  }
  return { fetch, calls }
}

function clock() {
  let t = 0
  const sleeps: number[] = []
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      t += ms
    },
    sleeps,
  }
}

describe("PoliteClient", () => {
  let dir: string | undefined
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = undefined
  })

  it("refuses a path robots.txt disallows, without requesting it", async () => {
    const site = fakeSite({ "https://s.fr/robots.txt": "User-agent: *\nDisallow: /panier" })
    const client = new PoliteClient({ fetch: site.fetch, ...clock() })
    await expect(client.get("https://s.fr/panier")).rejects.toBeInstanceOf(DisallowedError)
    expect(site.calls).toEqual(["https://s.fr/robots.txt"])
  })

  it("treats a missing robots.txt as allowing everything, and reads it once per host", async () => {
    const site = fakeSite({ "https://s.fr/a": "A", "https://s.fr/b": "B" })
    const client = new PoliteClient({ fetch: site.fetch, ...clock() })
    expect(await client.get("https://s.fr/a")).toBe("A")
    expect(await client.get("https://s.fr/b")).toBe("B")
    expect(site.calls.filter((c) => c.endsWith("robots.txt"))).toHaveLength(1)
  })

  it("spaces requests to one host by the larger of its interval and its Crawl-delay", async () => {
    const site = fakeSite({
      "https://s.fr/robots.txt": "User-agent: *\nCrawl-delay: 3",
      "https://s.fr/a": "A",
      "https://s.fr/b": "B",
    })
    const c = clock()
    const client = new PoliteClient({ fetch: site.fetch, minIntervalMs: 1000, ...c })
    await client.get("https://s.fr/a")
    await client.get("https://s.fr/b")
    // robots.txt, then /a after 1 s (robots is spaced at the base interval), then /b 3 s later.
    expect(c.now()).toBeGreaterThanOrEqual(4000)
  })

  it("backs off on 429, honouring Retry-After", async () => {
    const site = fakeSite({
      "https://s.fr/a": [{ status: 429, headers: { "retry-after": "7" } }, "A"],
    })
    const c = clock()
    const client = new PoliteClient({ fetch: site.fetch, minIntervalMs: 0, ...c })
    expect(await client.get("https://s.fr/a")).toBe("A")
    expect(c.sleeps).toContain(7000)
  })

  it("gives up after the last retry and on a plain 404", async () => {
    const site = fakeSite({ "https://s.fr/down": { status: 503 } })
    const client = new PoliteClient({ fetch: site.fetch, minIntervalMs: 0, maxRetries: 2, ...clock() })
    await expect(client.get("https://s.fr/down")).rejects.toBeInstanceOf(HttpError)
    expect(site.calls.filter((u) => u.endsWith("/down"))).toHaveLength(3)
    await expect(client.get("https://s.fr/missing")).rejects.toThrow(/404/)
  })

  it("retries a network error", async () => {
    const site = fakeSite({ "https://s.fr/a": [new Error("ECONNRESET"), "A"] })
    const client = new PoliteClient({ fetch: site.fetch, minIntervalMs: 0, ...clock() })
    expect(await client.get("https://s.fr/a")).toBe("A")
  })

  it("serves a second run from the disk cache without touching the site", async () => {
    dir = await mkdtemp(join(tmpdir(), "collect-cache-"))
    const first = fakeSite({ "https://s.fr/a": "A" })
    await new PoliteClient({ fetch: first.fetch, cacheDir: dir, ...clock() }).get("https://s.fr/a")
    expect(await readdir(dir)).toHaveLength(1)

    const second = fakeSite({})
    const text = await new PoliteClient({ fetch: second.fetch, cacheDir: dir, ...clock() }).get("https://s.fr/a")
    expect(text).toBe("A")
    expect(second.calls).toEqual([])
  })

  it("keeps session cookies when asked, and can bypass the cache", async () => {
    dir = await mkdtemp(join(tmpdir(), "collect-cache-"))
    const seen: (string | null)[] = []
    let n = 0
    const fetch = async (url: string, init?: RequestInit) => {
      if (url.endsWith("robots.txt")) return new Response("", { status: 404 })
      seen.push(new Headers(init?.headers).get("cookie"))
      return new Response(`page ${++n}`, { headers: { "set-cookie": "PHPSESSID=abc; path=/; HttpOnly" } })
    }
    const client = new PoliteClient({ fetch, cookies: true, cacheDir: dir, minIntervalMs: 0, ...clock() })
    expect(await client.get("https://s.fr/filter", { cache: false })).toBe("page 1")
    expect(await client.get("https://s.fr/list", { cache: false })).toBe("page 2")
    expect(await client.get("https://s.fr/list", { cache: false })).toBe("page 3")
    expect(seen).toEqual([null, "PHPSESSID=abc", "PHPSESSID=abc"])
    expect(await readdir(dir)).toEqual([])
  })

  it("exposes the sitemaps robots.txt declares", async () => {
    const site = fakeSite({ "https://s.fr/robots.txt": "Sitemap: https://s.fr/1_index_sitemap.xml" })
    const client = new PoliteClient({ fetch: site.fetch, ...clock() })
    expect(await client.declaredSitemaps("https://s.fr")).toEqual(["https://s.fr/1_index_sitemap.xml"])
  })
})
