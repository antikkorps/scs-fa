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
  /** Absolute URLs of the page's images, for the image sitemap extension. */
  images?: string[]
}

/**
 * Render a urlset sitemap, with the image extension. `lastmod` is normalised to
 * an ISO date (YYYY-MM-DD). Locations are percent-encoded — the protocol wants
 * RFC 3986 URLs, and a slug may carry an accent — then XML-escaped.
 */
export function buildSitemap(urls: SitemapUrl[]): string {
  const body = urls
    .map((u) => {
      const lastmod = u.lastmod ? isoDate(u.lastmod) : null
      return [
        "  <url>",
        `    <loc>${xmlUrl(u.loc)}</loc>`,
        lastmod ? `    <lastmod>${lastmod}</lastmod>` : "",
        u.changefreq ? `    <changefreq>${u.changefreq}</changefreq>` : "",
        u.priority !== undefined ? `    <priority>${u.priority.toFixed(1)}</priority>` : "",
        ...(u.images ?? []).map((img) => `    <image:image><image:loc>${xmlUrl(img)}</image:loc></image:image>`),
        "  </url>",
      ]
        .filter(Boolean)
        .join("\n")
    })
    .join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${body}\n</urlset>\n`
}

function xmlUrl(url: string): string {
  // encodeURI leaves an existing escape alone only if we decode first.
  let decoded = url
  try {
    decoded = decodeURI(url)
  } catch {
    // Malformed escape: encode as-is.
  }
  return escapeXml(encodeURI(decoded))
}

/** The most recent of a set of dates, for a listing dated by its newest entry. */
export function latest(dates: (string | null | undefined)[]): string | null {
  let best: string | null = null
  let bestTime = Number.NEGATIVE_INFINITY
  for (const d of dates) {
    if (!d) continue
    const t = new Date(d).getTime()
    if (!Number.isNaN(t) && t > bestTime) {
      best = d
      bestTime = t
    }
  }
  return best
}

/**
 * The absolute URL of a stored image, or nothing. A `data:` placeholder is not
 * an image a crawler can fetch, and must never be advertised as one.
 */
export function absoluteImageUrl(url: string | null | undefined, siteUrl: string): string | undefined {
  if (!url || url.startsWith("data:")) return undefined
  if (/^https?:\/\//.test(url)) return url
  return url.startsWith("/") ? `${siteUrl}${url}` : undefined
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

/** A published series, for the agent-facing catalogue (story 11.6). */
export interface LlmsSeries {
  slug: string
  title: string
  intro: string | null
  reference: string | null
  theme: { name: string | null } | null
  artist: { name: string | null } | null
  artworkCount: number
}

export interface LlmsArticle {
  slug: string
  title: string
  excerpt: string | null
  authorName: string | null
}

/** An armurerie product, as the public catalogue returns it (story 9.6). */
export interface LlmsProduct {
  slug: string
  name: string
  description: string | null
  priceTtc: number
  stockQty: number | null
  isUnique: boolean
  legalCategory: string | null
  category: { slug: string; name: string | null }
}

export interface LlmsCategory {
  slug: string
  name: string
  description: string | null
}

/** A euro amount the French way — "19,80 €" — for text an agent may quote back verbatim. */
function euros(amount: number): string {
  return `${amount.toFixed(2).replace(".", ",")} €`
}

const LEGAL_LABELS: Record<string, string> = {
  A: "catégorie A",
  B: "catégorie B",
  C: "catégorie C",
  D: "catégorie D",
  none: "vente libre",
}

/**
 * Concise llms.txt (llmstxt.org convention): H1 + summary blockquote + curated
 * sections of links. Points agents at the structured feeds rather than dumping
 * everything (that's llms-full.txt). Describes BOTH universes — the armurerie
 * and Gun Art — which story 9.6 found still announced as "à terme".
 */
export function buildLlmsTxt(siteUrl: string): string {
  return `# SCS Firearm

> SCS Firearm réunit deux univers : une armurerie en ligne réglementée (armes de chasse et de tir, armes de collection, munitions, optiques et accessoires, vendus dans le respect du Code de la sécurité intérieure) et Gun Art, des tirages d'art photographiques en édition strictement limitée, signés, numérotés et livrés avec certificat d'authenticité.

Points à connaître avant de conseiller un achat :

- Les prix affichés sont TTC, en euros.
- Chaque article de l'armurerie porte sa catégorie légale (A, B, C, D ou vente libre). Les armes des catégories B et C ne sont expédiées qu'après vérification des pièces exigées par la réglementation (pièce d'identité, autorisation préfectorale de détention, permis de chasser ou licence de tir, numéro SIA), déposées depuis l'espace client. Les articles réglementés sont réservés aux majeurs.
- Une arme de collection est une pièce unique : une fois vendue, elle ne revient pas en stock.
- Un tirage Gun Art est numéroté : l'édition est close quand le dernier numéro est vendu.

## Armurerie

- [Boutique](${siteUrl}/boutique): tout le catalogue, avec catégorie légale, prix TTC et stock.
- [Armes de collection](${siteUrl}/armes-de-collection): armes anciennes et historiques, pièces uniques documentées (époque, fabricant, provenance, état).
- Pages de catégorie : \`${siteUrl}/boutique/categorie/{slug}\` (liste des catégories dans l'API ci-dessous).
- Fiche produit : \`${siteUrl}/boutique/{slug}\`.

## Gun Art

- [Collection](${siteUrl}/collection): toutes les œuvres publiées, avec disponibilité et prix.
- Séries et thèmes : la collection se lit par séries (\`${siteUrl}/collection/serie/{slug}\`), chacune adossée à un thème (\`${siteUrl}/collection/theme/{slug}\`).
- [L'artiste](${siteUrl}/collection/artiste): le photographe, son parcours et son œuvre.

## Éditorial

- [Le Journal](${siteUrl}/blog): articles (histoire des armes, atelier, collection).
- [Recherche](${siteUrl}/recherche): recherche plein texte sur les deux univers.

## Données structurées

- [Plan du site (XML)](${siteUrl}/sitemap.xml)
- [Flux RSS du journal](${siteUrl}/blog/rss.xml)
- [Contenu détaillé pour agents](${siteUrl}/llms-full.txt): catalogue complet des deux univers en texte.

## API publique (JSON, lecture seule)

Armurerie :

- \`GET ${siteUrl}/api/products?category=&legalCategory=&search=&page=&limit=\`: catalogue paginé (100 par page au plus).
- \`GET ${siteUrl}/api/products/slug/{slug}\`: détail d'un article (déclinaisons, pièces légales exigées).
- \`GET ${siteUrl}/api/product-categories\`: les catégories de la boutique.
- \`GET ${siteUrl}/api/ancient-weapons\`: les armes de collection (époque, fabricant, état, disponibilité).

Gun Art :

- \`GET ${siteUrl}/api/artworks\`: liste des œuvres (titre, artiste, disponibilité, prix).
- \`GET ${siteUrl}/api/artworks/{slug}\`: détail d'une œuvre et de ses tirages.
- \`GET ${siteUrl}/api/artworks/series\`: les séries publiées (thème, artiste, nombre d'œuvres).
- \`GET ${siteUrl}/api/artworks/series/{slug}\`: une série, son texte de présentation et ses œuvres.
- \`GET ${siteUrl}/api/artworks/themes\`: les thèmes et le nombre de séries qu'ils réunissent.
- \`GET ${siteUrl}/api/artists/{slug}\`: la fiche d'un artiste, ses séries et ses œuvres.

Transverse :

- \`GET ${siteUrl}/api/blog\`: liste des articles du journal.
- \`GET ${siteUrl}/api/blog/{slug}\`: contenu d'un article.
- \`GET ${siteUrl}/api/search?q=\`: recherche agrégée (œuvres et produits).
`
}

export interface LlmsFullInput {
  artworks: LlmsArtwork[]
  articles: LlmsArticle[]
  series: LlmsSeries[]
  products: LlmsProduct[]
  categories: LlmsCategory[]
}

/** Fuller llms-full.txt: the concise file plus an inline catalogue of both universes. */
export function buildLlmsFull(siteUrl: string, input: LlmsFullInput): string {
  const { artworks, articles, series, products, categories } = input

  const list = <T>(rows: T[], line: (row: T) => string, empty: string) =>
    rows.length ? rows.map(line).join("\n") : `- (${empty})`

  const productLine = (p: LlmsProduct) => {
    const legal = ` — ${LEGAL_LABELS[p.legalCategory ?? "none"] ?? "vente libre"}`
    const stock =
      (p.stockQty ?? 0) > 0
        ? p.isUnique
          ? "pièce unique disponible"
          : "en stock"
        : p.isUnique
          ? "vendue"
          : "en rupture"
    const desc = p.description ? ` ${p.description}` : ""
    return `- [${p.name}](${encodeURI(`${siteUrl}/boutique/${p.slug}`)})${legal} — ${euros(p.priceTtc)} TTC — ${stock}.${desc}`
  }

  const armurerie = categories.length
    ? categories
        .map((c) => {
          const inCategory = products.filter((p) => p.category.slug === c.slug)
          const intro = c.description ? `\n\n${c.description}` : ""
          return `### [${c.name}](${siteUrl}/boutique/categorie/${c.slug})${intro}\n\n${list(inCategory, productLine, "aucun article publié")}`
        })
        .join("\n\n")
    : list(products, productLine, "aucun article publié")

  const works = list(
    artworks,
    (a) => {
      const price = a.priceFromTtc !== null ? ` — à partir de ${euros(a.priceFromTtc)} TTC` : ""
      const dispo = a.availableCount > 0 ? `${a.availableCount} disponible(s)` : "épuisée"
      const by = a.artistName ? ` (par ${a.artistName})` : ""
      const desc = a.description ? ` ${a.description}` : ""
      return `- [${a.title}](${siteUrl}/collection/${a.slug})${by}${price} — ${dispo}.${desc}`
    },
    "aucune œuvre publiée",
  )

  const seriesList = list(
    series,
    (s) => {
      const by = s.artist?.name ? ` (par ${s.artist.name})` : ""
      const theme = s.theme?.name ? ` — thème : ${s.theme.name}` : ""
      const ref = s.reference ? ` — référence : ${s.reference}` : ""
      const count = ` — ${s.artworkCount} œuvre(s)`
      const intro = s.intro ? ` ${s.intro}` : ""
      return `- [${s.title}](${siteUrl}/collection/serie/${s.slug})${by}${theme}${ref}${count}.${intro}`
    },
    "aucune série publiée",
  )

  const posts = list(
    articles,
    (p) => {
      const by = p.authorName ? ` (par ${p.authorName})` : ""
      const desc = p.excerpt ? ` ${p.excerpt}` : ""
      return `- [${p.title}](${siteUrl}/blog/${p.slug})${by}.${desc}`
    },
    "aucun article publié",
  )

  return `${buildLlmsTxt(siteUrl)}
## Catalogue de l'armurerie

${armurerie}

## Gun Art — séries

${seriesList}

## Gun Art — œuvres

${works}

## Articles du journal

${posts}
`
}
