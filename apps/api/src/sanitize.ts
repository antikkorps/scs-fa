import sanitizeHtml from "sanitize-html"
import { env } from "./env.js"

// Defence in depth for every admin-authored rich text the front renders as HTML:
// blog articles (story 9.4b) and the long descriptions telling a collection
// weapon's story (story 11.2).
//
// The TipTap editor already emits a constrained subset of HTML, but the API
// accepts arbitrary strings, so we sanitise on save: only the tags and
// attributes the editor can produce survive, and any script, style or
// event-handler payload is stripped — even if a compromised admin account POSTs
// raw HTML straight to the API.
//
// The rule that makes this safe is simple: a field rendered with `v-html` MUST
// have gone through here on the way in. Never relax one without the other.
// The site under both names: the canonical www host and the bare domain.
const SITE_HOST = new URL(env.WEB_BASE_URL).hostname.replace(/^www\./, "")
const SITE_HOSTS = new Set([SITE_HOST, `www.${SITE_HOST}`])

/** A web page on another site (protocol-relative included); not a path, a mailto, nor a scheme the filter drops. */
function isExternalWebLink(href: string): boolean {
  if (href.startsWith("/") && !href.startsWith("//")) return false
  try {
    const url = new URL(href, "https://relative.invalid")
    return (url.protocol === "https:" || url.protocol === "http:") && !SITE_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

/**
 * SEO audit 2026-11-15, finding 4: a link to the site's own pages is followed
 * and opens in place, so the journal passes weight to the pages it cites. A
 * link elsewhere stays hardened: no opener, no referrer, no endorsement.
 */
function transformLink(tagName: string, attribs: sanitizeHtml.Attributes): sanitizeHtml.Tag {
  const { rel: _rel, target, ...rest } = attribs
  if (!rest.href || !isExternalWebLink(rest.href)) return { tagName, attribs: rest }
  return { tagName, attribs: { ...rest, ...(target && { target }), rel: "noopener noreferrer nofollow" } }
}

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "strong",
    "em",
    "s",
    "u",
    "h2",
    "h3",
    "ul",
    "ol",
    "li",
    "blockquote",
    "a",
    "img",
    "code",
    "pre",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    img: ["src", "alt"],
  },
  // Absolute links are http(s)/mailto; image src is also relative (/api/blog/images/…),
  // which sanitize-html permits by default.
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: { a: transformLink },
}

export function sanitizeRichTextHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS)
}
