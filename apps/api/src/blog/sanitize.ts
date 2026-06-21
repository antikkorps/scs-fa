import sanitizeHtml from "sanitize-html"

// Defence in depth for article bodies. The TipTap editor already emits a
// constrained subset of HTML, but the API accepts arbitrary `content` strings,
// so we sanitise on save: only the tags/attributes the editor can produce
// survive, and any script/style/event-handler payload is stripped — even if a
// compromised admin account POSTs raw HTML straight to the API.
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

export function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS)
}
