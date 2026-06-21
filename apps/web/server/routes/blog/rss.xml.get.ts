// RSS 2.0 feed for the blog — discoverable by readers and crawlers (SEO).
// Pulls published articles from the API and renders a cached XML document.

interface BlogListItem {
  slug: string
  title: string
  excerpt: string | null
  publishedAt: string | null
  authorName: string | null
}

const escapeXml = (s: string): string =>
  s.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;"
      case ">":
        return "&gt;"
      case "&":
        return "&amp;"
      case "'":
        return "&apos;"
      default:
        return "&quot;"
    }
  })

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const apiBase = config.public.apiBase as string
  const siteUrl = config.public.siteUrl as string

  let items: BlogListItem[] = []
  try {
    const res = await $fetch<{ data: BlogListItem[] }>(`${apiBase}/blog`, { query: { limit: 50 } })
    items = res.data
  } catch {
    // Degrade to an empty but valid feed if the API is unreachable.
    items = []
  }

  const entries = items
    .map((a) => {
      const url = `${siteUrl}/blog/${a.slug}`
      const date = a.publishedAt ? new Date(a.publishedAt).toUTCString() : undefined
      return [
        "    <item>",
        `      <title>${escapeXml(a.title)}</title>`,
        `      <link>${escapeXml(url)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
        a.authorName ? `      <dc:creator>${escapeXml(a.authorName)}</dc:creator>` : "",
        date ? `      <pubDate>${date}</pubDate>` : "",
        a.excerpt ? `      <description>${escapeXml(a.excerpt)}</description>` : "",
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n")
    })
    .join("\n")

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>SCS Firearm — Le Journal</title>
    <link>${escapeXml(`${siteUrl}/blog`)}</link>
    <atom:link href="${escapeXml(`${siteUrl}/blog/rss.xml`)}" rel="self" type="application/rss+xml" />
    <description>Histoires &amp; coulisses de l'armurerie de collection et des éditions Gun Art.</description>
    <language>fr-FR</language>
${entries}
  </channel>
</rss>
`

  setHeader(event, "content-type", "application/rss+xml; charset=utf-8")
  setHeader(event, "cache-control", "public, max-age=600")
  return xml
})
