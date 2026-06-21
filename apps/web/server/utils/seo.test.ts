import { describe, expect, it } from "vitest"
import { buildLlmsFull, buildLlmsTxt, buildRobots, buildSitemap, escapeXml } from "./seo.js"

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
})

describe("buildLlmsFull", () => {
  it("appends a catalogue of works and articles", () => {
    const txt = buildLlmsFull(
      SITE,
      [
        {
          slug: "eclat",
          title: "Éclat",
          artistName: "Camille",
          description: "Une œuvre.",
          priceFromTtc: 216,
          availableCount: 3,
        },
      ],
      [{ slug: "histoire", title: "Histoire", excerpt: "Un extrait.", authorName: "Admin" }],
    )
    expect(txt).toContain("## Catalogue des œuvres")
    expect(txt).toContain(`[Éclat](${SITE}/collection/eclat)`)
    expect(txt).toContain("à partir de 216 € TTC")
    expect(txt).toContain("3 disponible(s)")
    expect(txt).toContain(`[Histoire](${SITE}/blog/histoire)`)
  })

  it("degrades gracefully with no content", () => {
    const txt = buildLlmsFull(SITE, [], [])
    expect(txt).toContain("(aucune œuvre publiée)")
    expect(txt).toContain("(aucun article publié)")
  })
})
