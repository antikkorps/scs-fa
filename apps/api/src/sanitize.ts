import sanitizeHtml from "sanitize-html"

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
  // Harden outbound links opened in a new tab.
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer nofollow" }),
  },
}

export function sanitizeRichTextHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS)
}
