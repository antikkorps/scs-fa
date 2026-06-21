// Pure builders for the discoverability surfaces (sitemap, robots, llms.txt).
// Kept side-effect-free so they can be unit-tested without a running server.

export function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => {
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
}

export interface SitemapUrl {
  loc: string
  lastmod?: string | null
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never"
  priority?: number
}

/** Render a urlset sitemap. `lastmod` is normalised to an ISO date (YYYY-MM-DD). */
export function buildSitemap(urls: SitemapUrl[]): string {
  const body = urls
    .map((u) => {
      const lastmod = u.lastmod ? isoDate(u.lastmod) : null
      return [
        "  <url>",
        `    <loc>${escapeXml(u.loc)}</loc>`,
        lastmod ? `    <lastmod>${lastmod}</lastmod>` : "",
        u.changefreq ? `    <changefreq>${u.changefreq}</changefreq>` : "",
        u.priority !== undefined ? `    <priority>${u.priority.toFixed(1)}</priority>` : "",
        "  </url>",
      ]
        .filter(Boolean)
        .join("\n")
    })
    .join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
}

function isoDate(value: string): string | null {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/** robots.txt allowing everything except the noindex search page, with the sitemap pointer. */
export function buildRobots(siteUrl: string): string {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /recherche",
    "Disallow: /admin",
    "",
    `Sitemap: ${siteUrl}/sitemap.xml`,
    "",
  ].join("\n")
}

export interface LlmsArtwork {
  slug: string
  title: string
  artistName: string | null
  description: string | null
  priceFromTtc: number | null
  availableCount: number
}

export interface LlmsArticle {
  slug: string
  title: string
  excerpt: string | null
  authorName: string | null
}

/**
 * Concise llms.txt (llmstxt.org convention): H1 + summary blockquote + curated
 * sections of links. Points agents at the structured feeds rather than dumping
 * everything (that's llms-full.txt).
 */
export function buildLlmsTxt(siteUrl: string): string {
  return `# SCS Firearm

> SCS Firearm édite et vend des tirages d'art photographiques en édition strictement limitée (Gun Art), signés, numérotés et livrés avec certificat d'authenticité. Le site propose aussi un journal éditorial et, à terme, une armurerie réglementée.

## Pages principales

- [Accueil](${siteUrl}/): présentation de la maison et des éditions Gun Art.
- [Collection](${siteUrl}/collection): toutes les œuvres publiées, avec disponibilité et prix.
- [Le Journal](${siteUrl}/blog): articles éditoriaux (histoire, atelier, collection).
- [Recherche](${siteUrl}/recherche): recherche plein texte sur les œuvres.

## Données structurées

- [Plan du site (XML)](${siteUrl}/sitemap.xml)
- [Flux RSS du journal](${siteUrl}/blog/rss.xml)
- [Contenu détaillé pour agents](${siteUrl}/llms-full.txt)

## API publique (JSON)

- \`GET ${siteUrl}/api/artworks\`: liste des œuvres (titre, artiste, disponibilité, prix).
- \`GET ${siteUrl}/api/artworks/{slug}\`: détail d'une œuvre et de ses tirages.
- \`GET ${siteUrl}/api/blog\`: liste des articles du journal.
- \`GET ${siteUrl}/api/blog/{slug}\`: contenu d'un article.
- \`GET ${siteUrl}/api/search?q=\`: recherche agrégée (œuvres et produits).
`
}

/** Fuller llms-full.txt: the concise file plus an inline catalogue of works and articles. */
export function buildLlmsFull(siteUrl: string, artworks: LlmsArtwork[], articles: LlmsArticle[]): string {
  const works = artworks.length
    ? artworks
        .map((a) => {
          const price = a.priceFromTtc !== null ? ` — à partir de ${a.priceFromTtc} € TTC` : ""
          const dispo = a.availableCount > 0 ? `${a.availableCount} disponible(s)` : "épuisée"
          const by = a.artistName ? ` (par ${a.artistName})` : ""
          const desc = a.description ? ` ${a.description}` : ""
          return `- [${a.title}](${siteUrl}/collection/${a.slug})${by}${price} — ${dispo}.${desc}`
        })
        .join("\n")
    : "- (aucune œuvre publiée)"

  const posts = articles.length
    ? articles
        .map((p) => {
          const by = p.authorName ? ` (par ${p.authorName})` : ""
          const desc = p.excerpt ? ` ${p.excerpt}` : ""
          return `- [${p.title}](${siteUrl}/blog/${p.slug})${by}.${desc}`
        })
        .join("\n")
    : "- (aucun article publié)"

  return `${buildLlmsTxt(siteUrl)}
## Catalogue des œuvres

${works}

## Articles du journal

${posts}
`
}
