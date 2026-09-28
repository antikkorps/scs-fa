import { readFileSync } from "node:fs"
import { collectedProductSchema } from "@armurier/shared"
import { describe, expect, it } from "vitest"
import { PoliteClient } from "../http.js"
import { isToroProductUrl, parseToroListing, parseToroMenu, parseToroProduct, toro, toroEan } from "./toro.js"

const fixture = (name: string) => readFileSync(new URL(`./fixtures/toro/${name}`, import.meta.url), "utf8")
const TORO = "https://www.toro-distribution.com"

function fakeClient(site: Record<string, string>, requested: string[]) {
  return new PoliteClient({
    minIntervalMs: 0,
    sleep: async () => {},
    fetch: async (url) => {
      requested.push(url)
      if (url === `${TORO}/robots.txt`) {
        return new Response(
          `User-agent: *\nDisallow: /*?order=\nDisallow: /*?n=\nSitemap: ${TORO}/1_index_sitemap.xml\n`,
        )
      }
      // Pages without a fixture answer an empty page: no product, no subcategory.
      return new Response(site[url] ?? "<html></html>")
    },
  })
}

describe("Toro Distribution", () => {
  it("reads the megamenu as Universe > Block > Category, categories only", () => {
    const categories = parseToroMenu(fixture("home-menu.html"))
    expect(categories).toContainEqual({ label: "Airsoft > Répliques", url: `${TORO}/975-repliques-airsoft` })
    expect(categories).toContainEqual({
      label: "Airsoft > Répliques > Répliques de Poing",
      url: `${TORO}/1016-repliques-de-poings-airsoft-pistolets-airsoft`,
    })
    // Promotions (`/s/…`) and the brands page are not categories.
    expect(categories.every((c) => /^https:\/\/www\.toro-distribution\.com\/\d+-[^/?.]+$/.test(c.url))).toBe(true)
    expect(new Set(categories.map((c) => c.url)).size).toBe(categories.length)
  })

  it("reads a leaf listing's products, and a parent listing's subcategories", () => {
    const leaf = parseToroListing(fixture("category-1012.html"))
    expect(leaf.productUrls).toHaveLength(4)
    expect(leaf.productUrls[0]).toBe(`${TORO}/13877-pack-fusil-modele-b-porte-cible-cibles-billes-marque-omicron.html`)
    expect(leaf.hasNext).toBe(false)

    const parent = parseToroListing(fixture("category-975.html"))
    expect(parent.productUrls).toEqual([])
    expect(parent.subcategories).toContainEqual({
      label: "PACKS répliques longues",
      url: `${TORO}/1012-packs-repliques-longues-d-airsoft`,
    })
    // The parent announces a page 2 although it lists nothing.
    expect(parent.hasNext).toBe(true)
  })

  it("reads a product from its data-product JSON: reference, brand, features, original images", () => {
    const url = `${TORO}/16220-pistolet-marque-rho-modele-a-marque-pi-spring.html`
    const p = parseToroProduct(fixture("product-16220.html"), url, undefined)
    expect(p).toMatchObject({
      supplierSku: "REF-P001-BK",
      name: "Pistolet MARQUE-RHO MODELE-A MARQUE-PI SPRING",
      brand: "MARQUE-PI",
      description: "Pistolet MARQUE-RHO MODELE-A à ressort de chez MARQUE-PI",
      sourceCategory: "Airsoft > Répliques > Répliques de Poing > Pistolets MARQUE-RHO",
      sourceUrl: url,
    })
    expect(p?.ean).toBeUndefined()
    expect(p?.longDescription).toContain("<strong> MARQUE-RHO MODELE-A</strong>")
    expect(p?.specs).toMatchObject({
      Calibre: "Billes plastique 6 mm",
      Propulsion: "SPRING (ressort)",
      "Capacité de tir": "14 billes",
      // Repeated features are joined; "-" placeholders are dropped.
      Caractéristiques: "Airsoft 6mm, ABS, SPRING",
    })
    expect(p?.specs["Hop-up réglable"]).toBeUndefined()
    expect(p?.imageUrls).toEqual([
      `${TORO}/img/p/1/8/9/8/0/18980.jpg`,
      `${TORO}/img/p/1/8/9/8/1/18981.jpg`,
      `${TORO}/img/p/1/8/9/8/2/18982.jpg`,
    ])
    expect(collectedProductSchema.safeParse({ ...p, supplier: "Toro Distribution" }).success).toBe(true)
  })

  it("reads a pack without its items' purchase prices, nor a related product's reference", () => {
    const html = fixture("product-13877.html")
    // The fixture does carry both traps.
    expect(html).toContain("wholesale_price")
    expect(html).toContain('class="product-reference"')
    const p = parseToroProduct(
      html,
      `${TORO}/13877-pack-fusil-modele-b-porte-cible-cibles-billes-marque-omicron.html`,
      undefined,
    )
    expect(p).toMatchObject({
      supplierSku: "REF-O001-PACK",
      brand: "MARQUE-OMICRON",
      sourceCategory: "Airsoft > Répliques > PACKS répliques longues",
      imageUrls: [`${TORO}/img/p/3/7/5/0/3/37503.jpg`],
    })
    expect(p?.description).toContain("Ce pack inclut :\n- 1 fusil MODELE-B")
    expect(Object.keys(p?.specs ?? {})).toHaveLength(23)
    expect(JSON.stringify(p)).not.toMatch(/88\.67|wholesale/)
    expect(collectedProductSchema.safeParse({ ...p, supplier: "Toro Distribution" }).success).toBe(true)
  })

  it("sums combinations up in one spec, and ignores their placeholder EAN", () => {
    const p = parseToroProduct(
      fixture("product-8776-variants.html"),
      `${TORO}/8776-chaussures-marque-upsilon-modele-e-montantes-black.html`,
      undefined,
    )
    expect(p?.supplierSku).toBe("REF-T001-BK")
    expect(p?.specs.Déclinaisons).toMatch(/^Pointure : 35, Pointure : 36, .*Pointure : 48$/)
    expect(p?.specs.Déclinaisons?.split(", ")).toHaveLength(14)
    expect(p?.ean).toBeUndefined()
    expect(p?.imageUrls).toHaveLength(3)
    expect(collectedProductSchema.safeParse({ ...p, supplier: "Toro Distribution" }).success).toBe(true)
  })

  it("keeps real EANs only", () => {
    expect(toroEan("0000000096164")).toBeUndefined()
    expect(toroEan("")).toBeUndefined()
    expect(toroEan(undefined)).toBeUndefined()
    expect(toroEan("4006381333932")).toBeUndefined()
    expect(toroEan("4006381333931")).toBe("4006381333931")
  })

  it("returns null for a page that is not a product", () => {
    expect(parseToroProduct(fixture("category-1012.html"), `${TORO}/1012-packs`, undefined)).toBeNull()
    expect(
      parseToroProduct('<div id="product-details" data-product="{not json"></div>', `${TORO}/x.html`, undefined),
    ).toBeNull()
  })

  it("walks the declared sitemap index for the whole catalogue, products only", async () => {
    const requested: string[] = []
    const client = fakeClient(
      {
        [`${TORO}/1_index_sitemap.xml`]: fixture("sitemap-index.xml"),
        [`${TORO}/1_fr_0_sitemap.xml`]: fixture("sitemap-fr.xml"),
      },
      requested,
    )
    const urls: string[] = []
    for await (const url of toro.discover(client, { filters: [] })) urls.push(url)
    expect(urls).toEqual([
      `${TORO}/13877-pack-fusil-modele-b-porte-cible-cibles-billes-marque-omicron.html`,
      `${TORO}/16220-pistolet-marque-rho-modele-a-marque-pi-spring.html`,
    ])
    expect(urls.every(isToroProductUrl)).toBe(true)
    expect(requested.some((u) => u === `${TORO}/`)).toBe(false)
  })

  it("walks in-scope menu categories, their subcategories and their pages", async () => {
    const leaf = fixture("category-1012.html")
    // The leaf category announces one more page, which repeats the same products.
    const withNext = leaf.replace(
      "</head>",
      `<link rel="next" href="${TORO}/1012-packs-repliques-longues-d-airsoft?page=2"></head>`,
    )
    const requested: string[] = []
    const client = fakeClient(
      {
        [`${TORO}/`]: fixture("home-menu.html"),
        [`${TORO}/975-repliques-airsoft`]: fixture("category-975.html"),
        [`${TORO}/1012-packs-repliques-longues-d-airsoft`]: withNext,
        [`${TORO}/1012-packs-repliques-longues-d-airsoft?page=2`]: leaf,
      },
      requested,
    )
    const urls: string[] = []
    for await (const url of toro.discover(client, { filters: ["^airsoft > répliques"] })) urls.push(url)

    expect(urls).toHaveLength(4)
    expect(new Set(urls).size).toBe(4)
    expect(requested).toContain(`${TORO}/1012-packs-repliques-longues-d-airsoft?page=2`)
    // The parent's empty listing stops at page 1; the leaf's second page added nothing new.
    expect(requested).not.toContain(`${TORO}/975-repliques-airsoft?page=2`)
    expect(requested).not.toContain(`${TORO}/1012-packs-repliques-longues-d-airsoft?page=3`)
    // Paintball is out of scope; the whole-catalogue sitemap is not read.
    expect(requested.some((u) => /paintball|sitemap/.test(u))).toBe(false)
    // Each category page is fetched once, although 1012 is both in the menu and a subcategory.
    expect(requested.filter((u) => u === `${TORO}/1012-packs-repliques-longues-d-airsoft`)).toHaveLength(1)

    // Without a breadcrumb on the product page, the menu path stands in.
    const bare = fixture("product-16220.html").replace(/<div class="breadcrumb">[\s\S]*?<\/nav>\s*<\/div>/, "")
    expect(toro.parse(bare, urls[0] as string)?.sourceCategory).toBe("Airsoft > Répliques > PACKS répliques longues")
  })
})
