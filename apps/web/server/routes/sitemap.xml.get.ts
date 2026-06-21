import { buildSitemap, type SitemapUrl } from "../utils/seo"

interface ArtworkItem {
  slug: string
}
interface BlogItem {
  slug: string
  publishedAt: string | null
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const apiBase = config.public.apiBase as string
  const siteUrl = config.public.siteUrl as string

  const urls: SitemapUrl[] = [
    { loc: `${siteUrl}/`, changefreq: "weekly", priority: 1 },
    { loc: `${siteUrl}/collection`, changefreq: "daily", priority: 0.9 },
    { loc: `${siteUrl}/blog`, changefreq: "weekly", priority: 0.7 },
  ]

  try {
    const [artworks, blog] = await Promise.all([
      $fetch<{ data: ArtworkItem[] }>(`${apiBase}/artworks`).catch(() => ({ data: [] })),
      $fetch<{ data: BlogItem[] }>(`${apiBase}/blog`, { query: { limit: 100 } }).catch(() => ({ data: [] })),
    ])
    for (const a of artworks.data) {
      urls.push({ loc: `${siteUrl}/collection/${a.slug}`, changefreq: "weekly", priority: 0.8 })
    }
    for (const p of blog.data) {
      urls.push({ loc: `${siteUrl}/blog/${p.slug}`, lastmod: p.publishedAt, changefreq: "monthly", priority: 0.6 })
    }
  } catch {
    // Fall back to the static URLs if the API is unreachable.
  }

  setHeader(event, "content-type", "application/xml; charset=utf-8")
  setHeader(event, "cache-control", "public, max-age=3600")
  return buildSitemap(urls)
})
