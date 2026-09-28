import * as cheerio from "cheerio"
import { describe, expect, it } from "vitest"
import { absoluteUrl, htmlToText, jsonLdOfType, ldImages, ldText, parseSitemap, truncate, unique } from "./extract.js"

describe("JSON-LD", () => {
  const page = cheerio.load(`
    <script type="application/ld+json">{ not json</script>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList"}</script>
    <script type="application/ld+json">{"@graph":[{"@type":["Product","Thing"],"name":"Lunette","brand":{"@type":"Brand","name":"Vortex"},"image":["a.jpg",{"url":"b.jpg"}]}]}</script>
  `)

  it("finds a typed node inside @graph, skipping malformed blocks", () => {
    const product = jsonLdOfType(page, "Product")
    expect(ldText(product?.name)).toBe("Lunette")
    expect(ldText(product?.brand)).toBe("Vortex")
    expect(ldImages(product?.image)).toEqual(["a.jpg", "b.jpg"])
  })

  it("returns null when there is no such node", () => {
    expect(jsonLdOfType(page, "Offer")).toBeNull()
  })

  it("reads numbers and ignores blanks", () => {
    expect(ldText(4006381333931)).toBe("4006381333931")
    expect(ldText("  ")).toBeUndefined()
  })
})

describe("absoluteUrl", () => {
  it("resolves relative URLs and refuses other schemes", () => {
    expect(absoluteUrl("/img/1.jpg", "https://s.fr/p/2")).toBe("https://s.fr/img/1.jpg")
    expect(absoluteUrl("javascript:alert(1)", "https://s.fr")).toBeUndefined()
    expect(absoluteUrl(undefined, "https://s.fr")).toBeUndefined()
  })
})

describe("text", () => {
  it("turns HTML into paragraphs of plain text", () => {
    expect(htmlToText("<p>Un  <b>viseur</b></p><ul><li>léger</li><li>solide</li></ul>")).toBe(
      "Un viseur\nléger\nsolide",
    )
  })

  it("truncates at a word boundary", () => {
    expect(truncate("un deux trois quatre", 12)).toBe("un deux…")
    expect(truncate("court", 12)).toBe("court")
  })

  it("keeps the first occurrence", () => {
    expect(unique(["a", "b", "a"])).toEqual(["a", "b"])
  })
})

describe("parseSitemap", () => {
  it("tells an index from a URL set", () => {
    expect(
      parseSitemap(
        `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://s.fr/fr_product_1.xml</loc></sitemap></sitemapindex>`,
      ),
    ).toEqual({ kind: "index", urls: ["https://s.fr/fr_product_1.xml"] })
    expect(
      parseSitemap(
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc> https://s.fr/a.html </loc><image:image><image:loc>https://s.fr/i.jpg</image:loc></image:image></url></urlset>`,
      ),
    ).toEqual({ kind: "urlset", urls: ["https://s.fr/a.html"] })
  })

  it("reads CDATA-wrapped locations (PrestaShop 1.7 gsitemap)", () => {
    expect(
      parseSitemap(
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc><![CDATA[https://s.fr/12-a.html]]></loc><image:image><image:loc><![CDATA[https://s.fr/1-large_default/a.jpg]]></image:loc></image:image></url></urlset>`,
      ),
    ).toEqual({ kind: "urlset", urls: ["https://s.fr/12-a.html"] })
  })
})
