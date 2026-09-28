import { readFileSync } from "node:fs"
import { collectedProductSchema } from "@armurier/shared"
import { describe, expect, it } from "vitest"
import { PoliteClient } from "../http.js"
import { bgmWinfield, parseBgmProduct, parseCategories, parseListingPage } from "./bgm.js"

const fixture = (name: string) => readFileSync(new URL(`./fixtures/bgm/${name}`, import.meta.url), "utf8")

describe("BGM Winfield", () => {
  it("reads the menu categories, the root one left out", () => {
    const categories = parseCategories(fixture("category-494.html"))
    expect(categories).toEqual(
      expect.arrayContaining([
        { label: "Points rouges", url: "https://bgmwinfield.fr/1132-points-rouges" },
        { label: "Armes", url: "https://bgmwinfield.fr/931-armes" },
      ]),
    )
    expect(categories.some((c) => c.url.endsWith("/2-accueil"))).toBe(false)
  })

  it("reads a listing page and its next page", () => {
    const page = parseListingPage(fixture("category-494.html"))
    expect(page.productUrls).toHaveLength(3)
    expect(page.productUrls[0]).toBe(
      "https://bgmwinfield.fr/optoelectronique/11884-swampfox-kingslayer-green-circle-1x22.html",
    )
    expect(page.next).toBe("https://bgmwinfield.fr/494-optoelectronique?page=2")
  })

  it("reads a product from its JSON-LD, with the ORIGINAL images", () => {
    const url = "https://bgmwinfield.fr/optoelectronique/11884-swampfox-kingslayer-green-circle-1x22.html"
    const p = parseBgmProduct(fixture("product-11884.html"), url)
    expect(p).toMatchObject({
      supplierSku: "OKS00122-GC",
      name: "Swampfox Kingslayer Green Circle 1X22",
      brand: "SWAMPFOX",
      sourceCategory: "Optoélectronique",
    })
    expect(p?.imageUrls).toHaveLength(6)
    expect(p?.imageUrls[0]).toBe("https://bgmwinfield.fr/img/p/1/4/1/8/3/14183.jpg")
    expect(p?.longDescription).toContain("Kingslayer")
    expect(collectedProductSchema.safeParse({ ...p, supplier: "BGM Winfield" }).success).toBe(true)
  })

  it("keeps the whole breadcrumb path of a nested category", () => {
    const p = parseBgmProduct(fixture("product-11832.html"), "https://bgmwinfield.fr/armes/11832-x.html")
    expect(p?.sourceCategory).toBe("Armes > Armes d'épaule")
    expect(p?.brand).toBe("ZRODELTA")
  })

  it("returns null for a page without product data", () => {
    expect(parseBgmProduct("<html><body>Page introuvable</body></html>", "https://bgmwinfield.fr/x")).toBeNull()
  })

  it("walks the root category for a full run, the matching categories for a scoped one", async () => {
    const listing = fixture("category-494.html")
    const requested: string[] = []
    const client = new PoliteClient({
      minIntervalMs: 0,
      sleep: async () => {},
      fetch: async (url) => {
        requested.push(url)
        if (url.endsWith("robots.txt")) return new Response("", { status: 404 })
        // Page 2 of anything: an empty listing ends the walk.
        return new Response(url.includes("page=2") ? "<html></html>" : listing)
      },
    })
    const full: string[] = []
    for await (const url of bgmWinfield.discover(client, { filters: [] })) full.push(url)
    expect(full).toHaveLength(3)
    expect(requested).toContain("https://bgmwinfield.fr/2-accueil")

    requested.length = 0
    const scoped: string[] = []
    for await (const url of bgmWinfield.discover(client, { filters: ["^points rouges$"] })) scoped.push(url)
    expect(requested).toContain("https://bgmwinfield.fr/1132-points-rouges")
    expect(requested.some((u) => u.includes("931-armes"))).toBe(false)
  })
})
