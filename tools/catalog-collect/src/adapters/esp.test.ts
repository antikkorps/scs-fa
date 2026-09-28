import { readFileSync } from "node:fs"
import { collectedProductSchema } from "@armurier/shared"
import { describe, expect, it } from "vitest"
import { PoliteClient } from "../http.js"
import { esp, espCategoryInScope, espProductUrl, parseEspCategories, parseEspListing, parseEspProduct } from "./esp.js"

const fixture = (name: string) => readFileSync(new URL(`./fixtures/esp/${name}`, import.meta.url), "utf8")
const ESP = "https://www.espfrance.com"
const productUrl = (id: number) => `${ESP}/product.php?id_product=${id}`

// ESP's own robots.txt, the rules that matter here.
const ROBOTS = [
  "User-agent: *",
  "Disallow: /modules/",
  "Disallow: /*orderby=",
  "Disallow: /*p=",
  "Disallow: /*n=",
  "# Sitemap",
  "Sitemap : http://www.espfrance.com/sitemap/google-SiteMap.xml",
].join("\n")

function fakeClient(site: Record<string, string>, requested: string[]) {
  return new PoliteClient({
    minIntervalMs: 0,
    sleep: async () => {},
    fetch: async (url) => {
      requested.push(url)
      if (url.endsWith("/robots.txt")) return new Response(ROBOTS)
      // Pages without a fixture answer an empty page: no product.
      return new Response(site[url] ?? "<html></html>")
    },
  })
}

describe("ESP France", () => {
  it("canonicalises product URLs", () => {
    expect(espProductUrl("http://www.espfrance.com/product.php?id_product=31")).toBe(productUrl(31))
    expect(espProductUrl("/product.php?id_product=31&id_lang=2")).toBe(productUrl(31))
    expect(espProductUrl("http://www.espfrance.com/category.php?id_category=2")).toBeUndefined()
    expect(espProductUrl("https://example.com/product.php?id_product=31")).toBeUndefined()
  })

  it("reads the category tree with its paths, plus the menu-only categories", () => {
    const categories = parseEspCategories(fixture("home.html"))
    expect(categories).toContainEqual({
      url: `${ESP}/category.php?id_category=177`,
      label: "AR15 - AR10",
      path: ["Armes et Accessoires", "Armes d'Epaule Semi Automatiques", "AR15 - AR10"],
    })
    // Only the top menu links to "Offres spéciales > Armes de Poing".
    expect(categories).toContainEqual({
      url: `${ESP}/category.php?id_category=208`,
      label: "Armes de Poing",
      path: ["Armes de Poing"],
    })
    expect(new Set(categories.map((c) => c.url)).size).toBe(categories.length)
    expect(categories.every((c) => /^https:\/\/www\.espfrance\.com\/category\.php\?id_category=\d+$/.test(c.url))).toBe(
      true,
    )
  })

  it("puts a category in scope through its own label or a parent's", () => {
    const [ar15] = parseEspCategories(fixture("home.html")).filter((c) => c.label === "AR15 - AR10")
    if (!ar15) throw new Error("fixture changed")
    expect(espCategoryInScope({ filters: ["^AR15"] }, ar15)).toBe(true)
    expect(espCategoryInScope({ filters: ["semi automatiques"] }, ar15)).toBe(true)
    expect(espCategoryInScope({ filters: ["optiques"] }, ar15)).toBe(false)
  })

  it("reads the first page of a listing", () => {
    const urls = parseEspListing(fixture("category-177.html"))
    expect(urls).toHaveLength(6)
    expect(urls[0]).toBe(productUrl(26585))
  })

  it("reads a product: reference, heading, brand, legal hint, breadcrumb, original image", () => {
    const p = parseEspProduct(fixture("product-34481.html"), productUrl(34481), undefined)
    expect(p).toMatchObject({
      supplierSku: "REF-O-V001",
      name: 'Pare Soleil Marque Mu 3" - 52mm (SERIE A)',
      brand: "Marque Mu",
      supplierLegalClass: "Vente Libre",
      sourceCategory: "Optiques > Accessoires > Pare Soleil & Anti-reflets",
      imageUrls: [`${ESP}/img/p/34481-11479.jpg`],
      specs: {},
    })
    // The Google Translate widget around the description is gone, its text kept.
    expect(p?.longDescription).toMatch(/^<p><span[^>]*>Pare-soleil Marque Mu de 3 pouces/)
    expect(p?.longDescription).not.toMatch(/tw-/)
    expect(collectedProductSchema.safeParse({ ...p, supplier: "ESP France" }).success).toBe(true)
  })

  it("keeps every image of the gallery, as originals", () => {
    const p = parseEspProduct(fixture("product-34074.html"), productUrl(34074), undefined)
    expect(p?.supplierSku).toBe("10001")
    expect(p?.name).toBe("Marque Nu Lunette exemple 8-32x56mm Réticule A-2")
    expect(p?.imageUrls).toHaveLength(7)
    expect(p?.imageUrls.every((u) => /^https:\/\/www\.espfrance\.com\/img\/p\/34074-\d+\.jpg$/.test(u))).toBe(true)
    expect(p?.longDescription).toContain("Cette lunette est livrée avec les accessoires suivants")
    expect(collectedProductSchema.safeParse({ ...p, supplier: "ESP France" }).success).toBe(true)
  })

  it("reads a firearm's legal hint without the footnote star", () => {
    const p = parseEspProduct(fixture("product-26585-firearm.html"), productUrl(26585), undefined)
    expect(p).toMatchObject({
      supplierSku: "REF-J-1",
      name: "Carabine exemple Cal. .223 Rem.",
      brand: "Marque Xi",
      supplierLegalClass: "Arme Réglementée",
      sourceCategory: "Armes et Accessoires > Armes d'Epaule Semi Automatiques > AR15 - AR10",
    })
    expect(p?.imageUrls).toEqual([`${ESP}/img/p/26585-879.jpg`, `${ESP}/img/p/26585-5912.jpg`])
    expect(collectedProductSchema.safeParse({ ...p, supplier: "ESP France" }).success).toBe(true)
  })

  it("falls back on the inline script for the reference", () => {
    const html = fixture("product-34481.html").replace(/<p id="product_reference">[\s\S]*?<\/p>/, "")
    expect(parseEspProduct(html, productUrl(34481), undefined)?.supplierSku).toBe("REF-O-V001")
  })

  it("returns null for a page that is not a product", () => {
    expect(parseEspProduct(fixture("category-177.html"), productUrl(1), undefined)).toBeNull()
    expect(
      parseEspProduct("<html><body><h1>Produit introuvable</h1></body></html>", productUrl(2), undefined),
    ).toBeNull()
  })

  it("reads the whole catalogue from the sitemap then every category's first page, never paginating", async () => {
    const requested: string[] = []
    const client = fakeClient(
      {
        "http://www.espfrance.com/sitemap/google-SiteMap.xml": fixture("sitemap.xml"),
        [`${ESP}/`]: fixture("home.html"),
        [`${ESP}/category.php?id_category=177`]: fixture("category-177.html"),
      },
      requested,
    )
    const urls: string[] = []
    for await (const url of esp.discover(client, { filters: [] })) urls.push(url)

    // Sitemap first (two products, in https), then what the listing adds.
    expect(urls.slice(0, 2)).toEqual([productUrl(31), productUrl(26585)])
    expect(urls).toHaveLength(2 + 5)
    expect(new Set(urls).size).toBe(urls.length)
    expect(requested.some((u) => /[?&]p=/.test(u))).toBe(false)
    const categories = parseEspCategories(fixture("home.html"))
    expect(requested.filter((u) => u.includes("category.php"))).toHaveLength(categories.length)
  })

  it("reads only the first page of in-scope categories", async () => {
    const requested: string[] = []
    const client = fakeClient(
      {
        [`${ESP}/`]: fixture("home.html"),
        [`${ESP}/category.php?id_category=177`]: fixture("category-177.html"),
      },
      requested,
    )
    const urls: string[] = []
    for await (const url of esp.discover(client, { filters: ["semi automatiques"] })) urls.push(url)

    expect(urls).toHaveLength(6)
    expect(requested.filter((u) => u.includes("category.php")).sort()).toEqual([
      `${ESP}/category.php?id_category=177`,
      `${ESP}/category.php?id_category=29`,
      `${ESP}/category.php?id_category=322`,
    ])
    expect(requested.some((u) => /sitemap|[?&]p=/i.test(u))).toBe(false)
    // Without a breadcrumb, the category path stands in.
    const bare = fixture("product-26585-firearm.html").replace(/<div class="breadcrumb">[\s\S]*?<\/div>/, "")
    expect(esp.parse(bare, productUrl(26585))?.sourceCategory).toBe(
      "Armes et Accessoires > Armes d'Epaule Semi Automatiques > AR15 - AR10",
    )
  })
})
