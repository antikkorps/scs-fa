// A small robots.txt reader: enough to honour what a site asks of every robot
// (`User-agent: *`) or of ours by name. Longest matching rule wins, `Allow`
// beats `Disallow` on a tie, `*` and `$` wildcards are understood — the
// behaviour RFC 9309 describes.

export interface RobotsRules {
  isAllowed(path: string): boolean
  crawlDelaySeconds: number | null
  sitemaps: string[]
}

interface Rule {
  allow: boolean
  pattern: string
}

function toRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith("$")
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*")
  return new RegExp(`^${body}${anchored ? "$" : ""}`)
}

export function parseRobots(text: string, userAgent: string): RobotsRules {
  const agent = userAgent.toLowerCase()
  const groups: { agents: string[]; rules: Rule[]; delay: number | null }[] = []
  const sitemaps: string[] = []
  let current: (typeof groups)[number] | null = null
  let lastWasAgent = false

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim()
    const sep = line.indexOf(":")
    if (sep === -1) continue
    const key = line.slice(0, sep).trim().toLowerCase()
    const value = line.slice(sep + 1).trim()
    if (key === "sitemap") {
      if (value) sitemaps.push(value)
      continue
    }
    if (key === "user-agent") {
      // Consecutive User-agent lines share one group.
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], delay: null }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!current) continue
    if (key === "disallow" && value) current.rules.push({ allow: false, pattern: value })
    else if (key === "allow" && value) current.rules.push({ allow: true, pattern: value })
    else if (key === "crawl-delay") {
      const n = Number(value)
      if (Number.isFinite(n) && n >= 0) current.delay = n
    }
  }

  // A group naming our robot takes precedence over the catch-all one.
  const named = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.includes(a)))
  const chosen = named.length > 0 ? named : groups.filter((g) => g.agents.includes("*"))
  const rules = chosen.flatMap((g) => g.rules).map((r) => ({ ...r, re: toRegExp(r.pattern) }))
  const delays = chosen.map((g) => g.delay).filter((d): d is number => d !== null)

  return {
    sitemaps,
    crawlDelaySeconds: delays.length > 0 ? Math.max(...delays) : null,
    isAllowed(path: string) {
      let best: { allow: boolean; length: number } | null = null
      for (const r of rules) {
        if (!r.re.test(path)) continue
        const length = r.pattern.length
        if (!best || length > best.length || (length === best.length && r.allow)) best = { allow: r.allow, length }
      }
      return best ? best.allow : true
    },
  }
}
