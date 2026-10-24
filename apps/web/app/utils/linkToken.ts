// Story 12.9g — the single-use tokens of mailed links (password reset,
// newsletter confirmation) travel in the URL fragment: a browser never sends
// the fragment to a server, so the token stays out of proxy and access logs,
// out of Referer headers, and out of the audience measurement.

const TOKEN_PARAM = "token"
// Only used to parse relative URLs; never part of a result.
const PARSE_BASE = "http://parse.invalid"

/** The token of a link's fragment (`#token=…`), or "" when there is none. */
export function linkTokenFromHash(hash: string): string {
  return new URLSearchParams(hash.replace(/^#/, "")).get(TOKEN_PARAM) ?? ""
}

/**
 * The URL with any link token removed, from the query string (the unsubscribe
 * link keeps its token there: mailbox one-click unsubscribe posts to it) and
 * from the fragment. Used on what the audience measurement records.
 */
export function withoutLinkTokens(url: string): string {
  if (!url.includes(`${TOKEN_PARAM}=`)) return url
  try {
    const parsed = new URL(url, PARSE_BASE)
    parsed.searchParams.delete(TOKEN_PARAM)
    if (linkTokenFromHash(parsed.hash)) parsed.hash = ""
    if (parsed.origin === PARSE_BASE) return `${parsed.pathname}${parsed.search}${parsed.hash}`
    return parsed.toString()
  } catch {
    return url
  }
}

/** An audience event as Umami's tracker sends it; only its URLs matter here. */
interface AudienceEvent {
  url?: unknown
  referrer?: unknown
  [field: string]: unknown
}

/** The event with link tokens removed from its page and referrer URLs. */
export function withoutLinkTokensInEvent<Event extends AudienceEvent>(event: Event): Event {
  const cleaned = { ...event }
  if (typeof cleaned.url === "string") cleaned.url = withoutLinkTokens(cleaned.url)
  if (typeof cleaned.referrer === "string") cleaned.referrer = withoutLinkTokens(cleaned.referrer)
  return cleaned
}
