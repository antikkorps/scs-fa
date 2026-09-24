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
  artworks: Entry[]
  series: Entry[]
  themes: Entry[]
  artists: Entry[]
  blogPosts: Entry[]
}

const EMPTY: SitemapPayload = {
  products: [],
  productCategories: [],
  artworks: [],
  series: [],
  themes: [],
  artists: [],
  blogPosts: [],
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const apiBase = config.public.apiBase as string
  const siteUrl = config.public.siteUrl as string

  // An unreachable API degrades to the static pages rather than failing the
  // whole sitemap — but it is not cached as if it were the real one.
  const payload = await $fetch<{ data: SitemapPayload }>(`${apiBase}/seo/sitemap`)
    .then((r) => r.data)
    .catch(() => null)
  const d = payload ?? EMPTY

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
    ...(d.artists.length > 0
      ? [
          {
            loc: `${siteUrl}/collection/artiste`,
            lastmod: latest(d.artists.map(dated)),
            changefreq: "monthly" as const,
            priority: 0.6,
          },
        ]
      : []),
    { loc: `${siteUrl}/blog`, lastmod: latest(d.blogPosts.map(dated)), changefreq: "weekly", priority: 0.7 },

    // Armurerie: category pages, then products.
    ...d.productCategories.map((c) => ({
      loc: `${siteUrl}/boutique/categorie/${c.slug}`,
      lastmod: c.updatedAt,
      changefreq: "weekly" as const,
      priority: 0.8,
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

  setHeader(event, "content-type", "application/xml; charset=utf-8")
  setHeader(event, "cache-control", payload ? "public, max-age=3600" : "no-store")
  return buildSitemap(urls)
})
