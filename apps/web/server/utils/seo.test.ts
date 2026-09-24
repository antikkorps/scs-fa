import { describe, expect, it } from "vitest"
import { absoluteImageUrl, buildLlmsFull, buildLlmsTxt, buildRobots, buildSitemap, escapeXml, latest } from "./seo.js"

const SITE = "https://www.scs-firearms.com"

describe("escapeXml", () => {
  it("escapes XML-significant characters", () => {
    expect(escapeXml(`a<b>&'"`)).toBe("a&lt;b&gt;&amp;&apos;&quot;")
  })
})

describe("buildSitemap", () => {
  it("renders a urlset with loc, normalised lastmod, changefreq and priority", () => {
    const xml = buildSitemap([
      { loc: `${SITE}/`, changefreq: "weekly", priority: 1 },
      { loc: `${SITE}/blog/x`, lastmod: "2026-06-01T10:30:00.000Z", priority: 0.6 },
    ])
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain(`<loc>${SITE}/</loc>`)
    expect(xml).toContain("<lastmod>2026-06-01</lastmod>")
    expect(xml).toContain("<priority>1.0</priority>")
    expect(xml).toContain("<changefreq>weekly</changefreq>")
  })

  it("omits lastmod when absent or unparseable", () => {
    const xml = buildSitemap([{ loc: `${SITE}/a`, lastmod: "not-a-date" }])
    expect(xml).not.toContain("<lastmod>")
  })

  it("escapes the loc", () => {
    expect(buildSitemap([{ loc: `${SITE}/?q=a&b` }])).toContain("?q=a&amp;b")
  })
})

describe("buildSitemap — story 9.6", () => {
  it("declares the sitemaps.org namespace (with an s) and the image extension", () => {
    const xml = buildSitemap([{ loc: `${SITE}/` }])
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')
    expect(xml).toContain('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"')
  })

  it("percent-encodes an accented slug, without double-encoding an escaped one", () => {
    expect(buildSitemap([{ loc: `${SITE}/boutique/luger-p08-daté-1917` }])).toContain(
      "/boutique/luger-p08-dat%C3%A9-1917</loc>",
    )
    expect(buildSitemap([{ loc: `${SITE}/boutique/dat%C3%A9` }])).toContain("/boutique/dat%C3%A9</loc>")
  })

  it("lists a page's images", () => {
    const xml = buildSitemap([{ loc: `${SITE}/collection/x`, images: [`${SITE}/api/media/x.webp`] }])
    expect(xml).toContain(`<image:image><image:loc>${SITE}/api/media/x.webp</image:loc></image:image>`)
  })
})

describe("latest", () => {
  it("returns the most recent date, ignoring gaps and garbage", () => {
    expect(latest(["2026-01-01T00:00:00Z", null, "nope", "2026-03-01T00:00:00Z", undefined])).toBe(
      "2026-03-01T00:00:00Z",
    )
    expect(latest([])).toBeNull()
  })
})

describe("absoluteImageUrl", () => {
  it("makes a stored path absolute and keeps an absolute URL", () => {
    expect(absoluteImageUrl("/api/media/a.jpg", SITE)).toBe(`${SITE}/api/media/a.jpg`)
    expect(absoluteImageUrl("https://cdn.example/a.jpg", SITE)).toBe("https://cdn.example/a.jpg")
  })
  it("never advertises a data: placeholder or an unusable value", () => {
    expect(absoluteImageUrl("data:image/svg+xml,<svg/>", SITE)).toBeUndefined()
    expect(absoluteImageUrl(null, SITE)).toBeUndefined()
    expect(absoluteImageUrl("relative.jpg", SITE)).toBeUndefined()
  })
})

describe("buildRobots", () => {
  it("allows crawling, blocks search/admin, and points to the sitemap", () => {
    const txt = buildRobots(SITE)
    expect(txt).toContain("Allow: /")
    expect(txt).toContain("Disallow: /recherche")
    expect(txt).toContain("Disallow: /admin")
    expect(txt).toContain(`Sitemap: ${SITE}/sitemap.xml`)
  })
})

describe("buildLlmsTxt", () => {
  it("produces an H1, a summary blockquote and the key links", () => {
    const txt = buildLlmsTxt(SITE)
    expect(txt.startsWith("# SCS Firearm")).toBe(true)
    expect(txt).toContain("> SCS Firearm")
    expect(txt).toContain(`[Collection](${SITE}/collection)`)
    expect(txt).toContain(`${SITE}/llms-full.txt`)
    expect(txt).toContain(`GET ${SITE}/api/artworks`)
  })

  it("points agents at the editorial routes added by story 11.6", () => {
    const txt = buildLlmsTxt(SITE)
    expect(txt).toContain(`GET ${SITE}/api/artworks/series`)
    expect(txt).toContain(`GET ${SITE}/api/artworks/themes`)
    expect(txt).toContain(`GET ${SITE}/api/artists/{slug}`)
  })

  it("presents the armurerie as a live universe, not a future one (story 9.6)", () => {
    const txt = buildLlmsTxt(SITE)
    expect(txt).not.toContain("à terme")
    expect(txt).toContain("## Armurerie")
    expect(txt).toContain(`[Boutique](${SITE}/boutique)`)
    expect(txt).toContain(`[Armes de collection](${SITE}/armes-de-collection)`)
    expect(txt).toContain(`${SITE}/boutique/categorie/{slug}`)
    expect(txt).toContain(`GET ${SITE}/api/products`)
    expect(txt).toContain(`GET ${SITE}/api/ancient-weapons`)
  })

  it("tells an agent the legal constraints before it recommends a purchase", () => {
    const txt = buildLlmsTxt(SITE)
    expect(txt).toContain("catégories B et C")
    expect(txt).toContain("pièce unique")
  })
})

const EMPTY = { artworks: [], articles: [], series: [], products: [], categories: [] }

describe("buildLlmsFull", () => {
  it("appends a catalogue of works and articles", () => {
    const txt = buildLlmsFull(SITE, {
      ...EMPTY,
      artworks: [
        {
          slug: "eclat",
          title: "Éclat",
          artistName: "Camille",
          description: "Une œuvre.",
          priceFromTtc: 216,
          availableCount: 3,
        },
      ],
      articles: [{ slug: "histoire", title: "Histoire", excerpt: "Un extrait.", authorName: "Admin" }],
    })
    expect(txt).toContain("## Gun Art — œuvres")
    expect(txt).toContain(`[Éclat](${SITE}/collection/eclat)`)
    expect(txt).toContain("à partir de 216,00 € TTC")
    expect(txt).toContain("3 disponible(s)")
    expect(txt).toContain(`[Histoire](${SITE}/blog/histoire)`)
  })

  it("lists the series with their theme, reference and artist", () => {
    const txt = buildLlmsFull(SITE, {
      ...EMPTY,
      series: [
        {
          slug: "age-d-or",
          title: "Âge d'or",
          intro: "Une série sur l'avant-guerre.",
          reference: "Le cinéma d'espionnage",
          theme: { name: "Cinéma" },
          artist: { name: "Camille" },
          artworkCount: 2,
        },
      ],
    })
    expect(txt).toContain("## Gun Art — séries")
    expect(txt).toContain(`[Âge d'or](${SITE}/collection/serie/age-d-or)`)
    expect(txt).toContain("thème : Cinéma")
    expect(txt).toContain("référence : Le cinéma d'espionnage")
    expect(txt).toContain("2 œuvre(s)")
  })

  it("lays the armurerie out by category, each product with its legal category, price and stock", () => {
    const product = {
      description: null,
      stockQty: 4,
      isUnique: false,
      legalCategory: "B",
      category: { slug: "arme-poing", name: "Armes de poing" },
    }
    const txt = buildLlmsFull(SITE, {
      ...EMPTY,
      categories: [
        { slug: "arme-poing", name: "Armes de poing", description: "Pistolets et revolvers" },
        { slug: "munition", name: "Munitions", description: null },
      ],
      products: [
        { ...product, slug: "glock-17", name: "Glock 17", priceTtc: 720 },
        { ...product, slug: "luger-p08-daté-1917", name: "Luger P08", priceTtc: 19.8 },
        {
          ...product,
          slug: "lefaucheux-1854",
          name: "Lefaucheux 1854",
          priceTtc: 2880,
          stockQty: 0,
          isUnique: true,
          legalCategory: "D",
        },
      ],
    })
    expect(txt).toContain("## Catalogue de l'armurerie")
    expect(txt).toContain(`### [Armes de poing](${SITE}/boutique/categorie/arme-poing)`)
    expect(txt).toContain("Pistolets et revolvers")
    expect(txt).toContain(`- [Glock 17](${SITE}/boutique/glock-17) — catégorie B — 720,00 € TTC — en stock.`)
    // A sold collection piece is gone for good — not "out of stock".
    expect(txt).toContain(
      `- [Lefaucheux 1854](${SITE}/boutique/lefaucheux-1854) — catégorie D — 2880,00 € TTC — vendue.`,
    )
    expect(txt).toContain("19,80 € TTC")
    expect(txt).toContain(`${SITE}/boutique/luger-p08-dat%C3%A9-1917`)
    expect(txt).toContain(`### [Munitions](${SITE}/boutique/categorie/munition)\n\n- (aucun article publié)`)
  })

  it("degrades gracefully with no content", () => {
    const txt = buildLlmsFull(SITE, EMPTY)
    expect(txt).toContain("(aucune œuvre publiée)")
    expect(txt).toContain("(aucun article publié)")
    expect(txt).toContain("(aucune série publiée)")
  })
})
