import { describe, expect, it } from "vitest"
import { parseRobots } from "./robots.js"

const UA = "SCS-Firearm-CatalogCollect/1.0"

describe("parseRobots", () => {
  it("applies the catch-all group", () => {
    const r = parseRobots("User-agent: *\nDisallow: /panier\nDisallow: /*?order=", UA)
    expect(r.isAllowed("/panier")).toBe(false)
    expect(r.isAllowed("/panier/x")).toBe(false)
    expect(r.isAllowed("/12-lunettes?order=price")).toBe(false)
    expect(r.isAllowed("/12-lunettes")).toBe(true)
  })

  it("lets the longest rule win, and Allow win a tie", () => {
    const r = parseRobots("User-agent: *\nDisallow: /modules/\nAllow: /modules/img/\nDisallow: /a\nAllow: /a", UA)
    expect(r.isAllowed("/modules/x.js")).toBe(false)
    expect(r.isAllowed("/modules/img/x.jpg")).toBe(true)
    expect(r.isAllowed("/a")).toBe(true)
  })

  it("understands the end anchor", () => {
    const r = parseRobots("User-agent: *\nDisallow: /*.pdf$", UA)
    expect(r.isAllowed("/cat.pdf")).toBe(false)
    expect(r.isAllowed("/cat.pdf?x=1")).toBe(true)
  })

  it("refuses everything on Disallow: /", () => {
    expect(parseRobots("User-agent: *\nDisallow: /", UA).isAllowed("/produit/1")).toBe(false)
  })

  it("prefers a group naming our robot over the catch-all", () => {
    const r = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: SCS-Firearm-CatalogCollect\nAllow: /", UA)
    expect(r.isAllowed("/produit/1")).toBe(true)
  })

  it("ignores groups meant for other robots", () => {
    const r = parseRobots("User-agent: Googlebot\nDisallow: /", UA)
    expect(r.isAllowed("/x")).toBe(true)
  })

  it("reads the crawl delay and the sitemaps, and ignores comments", () => {
    const r = parseRobots(
      "# hello\nSitemap: https://a.fr/sitemap.xml\nUser-agent: *\nCrawl-delay: 5 # be nice\nDisallow:",
      UA,
    )
    expect(r.crawlDelaySeconds).toBe(5)
    expect(r.sitemaps).toEqual(["https://a.fr/sitemap.xml"])
    expect(r.isAllowed("/anything")).toBe(true)
  })

  it("reads a sitemap declared with a space before the colon (ESP France)", () => {
    const r = parseRobots(
      "User-agent: *\nDisallow: /*p=\n\n# Sitemap\nSitemap : http://www.e.com/sitemap/google-SiteMap.xml\n",
      UA,
    )
    expect(r.sitemaps).toEqual(["http://www.e.com/sitemap/google-SiteMap.xml"])
    // `/*p=` forbids pagination but not the product and category controllers.
    expect(r.isAllowed("/category.php?id_category=177&p=2")).toBe(false)
    expect(r.isAllowed("/category.php?id_category=177")).toBe(true)
    expect(r.isAllowed("/product.php?id_product=34481")).toBe(true)
  })

  it("allows everything when robots.txt is empty", () => {
    expect(parseRobots("", UA).isAllowed("/x")).toBe(true)
  })
})
