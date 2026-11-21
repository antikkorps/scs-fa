import { menuShortcuts } from "#shared/utils/menu"
import { absoluteImageUrl, buildSitemap, latest, type SitemapUrl } from "../utils/seo"

interface Entry {
  slug: string
  updatedAt: string | null
  imageUrl?: string | null
}

/** Shape of `GET /api/seo/sitemap` (story 9.6). */
interface SitemapPayload {
  products: (Entry & { isAncientWeapon: boolean })[]
  productCategories: Entry[]
  tags: Entry[]
  artworks: Entry[]
  series: Entry[]
  themes: Entry[]
  artists: Entry[]
  blogPosts: Entry[]
  /** Story 12.15c — the shop menu's pages that show products. */
  menuPages: { path: string; updatedAt: string | null }[]
}

const EMPTY: SitemapPayload = {
  products: [],
  productCategories: [],
  tags: [],
  artworks: [],
  series: [],
  themes: [],
  artists: [],
  blogPosts: [],
  menuPages: [],
}

/**
 * The sitemap's data, read from the API at most every ten minutes (SEO audit
 * 2026-11-15, finding 6). A failed read throws, and Nitro caches no error: an
 * outage is never served for ten minutes as if it were the real sitemap.
 */
const cachedSitemapData = defineCachedFunction(
  async (): Promise<SitemapPayload> => {
    const { base, headers } = serverUpstream()
    const res = await $fetch<{ data: SitemapPayload }>(`${base}/seo/sitemap`, { headers })
    return res.data
  },
  { ...AGENT_FILE_CACHE, name: "sitemap-data", getKey: () => "all" },
)

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const siteUrl = config.public.siteUrl as string
  setHeader(event, "content-type", "application/xml; charset=utf-8")

  // Story 12.10: until robots may index the site there is nothing to submit.
  // Not cached for long, so switching indexing on is picked up quickly.
  if (!(await shopStatus()).indexingEnabled) {
    setHeader(event, "cache-control", "public, max-age=300")
    return buildSitemap([])
  }

  // An unreachable API degrades to the static pages rather than failing the
  // whole sitemap — but it is not cached as if it were the real one.
  const payload = await cachedSitemapData().catch(() => null)
  const d = payload ?? EMPTY
  // A category or tag with its menu entry is listed there (its canonical), once.
  const shortcuts = menuShortcuts(await shopMenuOrNone())
  // A legal page waits for every fact about the seller (shop_identity) too.
  const legalPaths = await publishableLegalPaths()

  const images = (e: Entry) => {
    const img = absoluteImageUrl(e.imageUrl, siteUrl)
    return img ? [img] : undefined
  }
  const dated = (e: Entry) => e.updatedAt
  const ancient = d.products.filter((p) => p.isAncientWeapon)

  // Listings are dated by their newest entry: that is when their content last changed.
  const urls: SitemapUrl[] = [
    {
      loc: `${siteUrl}/`,
      lastmod: latest([...d.products, ...d.artworks, ...d.blogPosts].map(dated)),
      changefreq: "weekly",
      priority: 1,
    },
    // The two universes.
    { loc: `${siteUrl}/boutique`, lastmod: latest(d.products.map(dated)), changefreq: "daily", priority: 0.9 },
    { loc: `${siteUrl}/collection`, lastmod: latest(d.artworks.map(dated)), changefreq: "daily", priority: 0.9 },
    ...(ancient.length > 0
      ? [
          {
            loc: `${siteUrl}/armes-de-collection`,
            lastmod: latest(ancient.map(dated)),
            changefreq: "weekly" as const,
            priority: 0.8,
          },
        ]
      : []),
    // (/collection/artiste is deliberately absent: a noindex router page.)
    { loc: `${siteUrl}/blog`, lastmod: latest(d.blogPosts.map(dated)), changefreq: "weekly", priority: 0.7 },
    { loc: `${siteUrl}/contact`, changefreq: "yearly", priority: 0.4 },
    // The pro signup page is indexable (nuxt.config): listed so it is found.
    { loc: `${siteUrl}/pro/inscription`, changefreq: "yearly", priority: 0.4 },
    // Reference pages, once validated and complete (shared/utils/editorialPages.ts).
    ...legalPaths.map((path) => ({
      loc: `${siteUrl}${path}`,
      changefreq: "yearly" as const,
      priority: 0.3,
    })),

    // Armurerie: the menu's pages, the other category and tag pages, then products.
    ...d.menuPages.map((page) => ({
      loc: `${siteUrl}${page.path}`,
      lastmod: page.updatedAt,
      changefreq: "weekly" as const,
      priority: 0.8,
    })),
    ...d.productCategories
      .filter((category) => !shortcuts.categories.has(category.slug))
      .map((category) => ({
        loc: `${siteUrl}/boutique/categorie/${category.slug}`,
        lastmod: category.updatedAt,
        changefreq: "weekly" as const,
        priority: 0.8,
      })),
    // Tag pages: only tags on at least one published product reach this list.
    ...d.tags
      .filter((tag) => !shortcuts.tags.has(tag.slug))
      .map((tag) => ({
        loc: `${siteUrl}/boutique/tag/${encodeURIComponent(tag.slug)}`,
        lastmod: tag.updatedAt,
        changefreq: "weekly" as const,
        priority: 0.6,
      })),
    ...d.products.map((p) => ({
      loc: `${siteUrl}/boutique/${p.slug}`,
      lastmod: p.updatedAt,
      changefreq: "weekly" as const,
      priority: 0.7,
      images: images(p),
    })),

    // Gun Art. The series is the editorial unit, so it ranks above a single work.
    ...d.series.map((s) => ({
      loc: `${siteUrl}/collection/serie/${s.slug}`,
      lastmod: s.updatedAt,
      changefreq: "weekly" as const,
      priority: 0.85,
      images: images(s),
    })),
    ...d.artworks.map((a) => ({
      loc: `${siteUrl}/collection/${a.slug}`,
      lastmod: a.updatedAt,
      changefreq: "weekly" as const,
      priority: 0.8,
      images: images(a),
    })),
    ...d.themes.map((t) => ({
      loc: `${siteUrl}/collection/theme/${t.slug}`,
      lastmod: t.updatedAt,
      changefreq: "monthly" as const,
      priority: 0.6,
    })),
    ...d.artists.map((a) => ({
      loc: `${siteUrl}/collection/artiste/${a.slug}`,
      lastmod: a.updatedAt,
      changefreq: "monthly" as const,
      priority: 0.7,
      images: images(a),
    })),

    // The journal.
    ...d.blogPosts.map((p) => ({
      loc: `${siteUrl}/blog/${p.slug}`,
      lastmod: p.updatedAt,
      changefreq: "monthly" as const,
      priority: 0.6,
      images: images(p),
    })),
  ]

  setHeader(event, "cache-control", payload ? "public, max-age=3600" : "no-store")
  return buildSitemap(urls)
})
