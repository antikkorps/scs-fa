import { readFileSync } from "node:fs"
import { collectedProductSchema } from "@armurier/shared"
import { describe, expect, it } from "vitest"
import { PoliteClient } from "../http.js"
import { humbert, parseFamilies, parseHumbertProduct, parseListing, parseSiblings } from "./humbert.js"

const fixture = (name: string) => readFileSync(new URL(`./fixtures/humbert/${name}`, import.meta.url), "utf8")

describe("Humbert", () => {
  it("lists the families, without filtered variants", () => {
    const families = parseFamilies(fixture("home-nav.html"))
    expect(families.map((f) => f.label)).toEqual(
      expect.arrayContaining(["Carabines", "Optiques", "Munitions", "Armes de poing"]),
    )
    expect(families.every((f) => /^https:\/\/www\.humbert\.com\/fr\/famille\/[a-z-]+$/.test(f.url))).toBe(true)
  })

  it("reads a listing batch and the parameters of the next one", () => {
    const batch = parseListing(fixture("listing-carabines.html"))
    expect(batch.productUrls).toHaveLength(2)
    expect(batch.next).toEqual({ famille: "3", page: "1", ordre: "2" })
    const last = parseListing(JSON.parse(fixture("listing-carabines-page2.json")).html)
    expect(last.next).toBeNull()
  })

  it("reads an article: reference, specs, supplier legal class, images, siblings", () => {
    const url = "https://www.humbert.com/fr/produit/cara-ruger-10-22"
    const p = parseHumbertProduct(fixture("product-ruger-1022.html"), url, "Carabines")
    expect(p).toMatchObject({
      supplierSku: "32301698",
      name: 'CARA RUGER 10/22 CARBINE 22LR 16.4" 42CM 10CPS STD SYNTH SATIN NOIRE (1C)1/2"-28',
      brand: "Ruger",
      sourceCategory: "Carabines > Percussion Annulaire",
      supplierLegalClass: "B2abis",
    })
    expect(p?.specs).toMatchObject({
      Calibre: "22 LR",
      "Réf. RGA": "CK784",
      Chargeur: "10",
      Gamme: "SEMI-AUTOMATIQUES 10/22",
    })
    // Neither the price nor the legal class leak into the specifications.
    expect(Object.keys(p?.specs ?? {}).some((k) => /prix|catégorie/i.test(k))).toBe(false)
    expect(p?.imageUrls).toHaveLength(1)
    expect(p?.imageUrls[0]).toContain(
      "humbert.contenthub.fi/NiboWEB/humbert/getPublicFile.do?uuid=25016447&inline=false",
    )
    expect(p?.longDescription).toBeUndefined()
    expect(collectedProductSchema.safeParse({ ...p, supplier: "Humbert" }).success).toBe(true)

    expect(parseSiblings(fixture("product-ruger-1022.html")).length).toBeGreaterThan(0)
  })

  it("keeps the description when there is one, and every image of the gallery", () => {
    const tikka = parseHumbertProduct(
      fixture("product-tikka-t3x.html"),
      "https://www.humbert.com/fr/produit/t",
      undefined,
    )
    expect(tikka?.longDescription).toContain("La T3x Lite combine")
    const sako = parseHumbertProduct(
      fixture("product-sako-100.html"),
      "https://www.humbert.com/fr/produit/s",
      undefined,
    )
    expect(sako?.imageUrls).toHaveLength(7)
  })

  it("returns null for a page that is not an article", () => {
    expect(
      parseHumbertProduct(
        "<html><body><h1>Page introuvable</h1></body></html>",
        "https://www.humbert.com/x",
        undefined,
      ),
    ).toBeNull()
  })

  it("walks a family: batches, then each model's siblings, once each", async () => {
    const listing = fixture("listing-carabines.html")
    const [firstModel] = parseListing(listing).productUrls
    const site: Record<string, string> = {
      "https://www.humbert.com/fr/": fixture("home-nav.html"),
      "https://www.humbert.com/fr/famille/carabines": listing,
      "https://www.humbert.com/fr/famille/3/page/1/2": fixture("listing-carabines-page1.json"),
      "https://www.humbert.com/fr/famille/3/page/2/5": fixture("listing-carabines-page2.json"),
      [firstModel as string]: fixture("product-ruger-1022.html"),
    }
    const requested: string[] = []
    const client = new PoliteClient({
      minIntervalMs: 0,
      sleep: async () => {},
      fetch: async (url) => {
        requested.push(url)
        const body = site[url]
        // Model pages without a fixture answer an empty page: no siblings.
        return new Response(body ?? "<html></html>", { status: url.endsWith("robots.txt") ? 404 : 200 })
      },
    })
    const urls: string[] = []
    for await (const url of humbert.discover(client, { filters: ["^carabines$"] })) urls.push(url)

    expect(new Set(urls).size).toBe(urls.length)
    const siblings = parseSiblings(fixture("product-ruger-1022.html"))
    // 5 models over three batches, plus the siblings listed on the first one.
    expect(urls.length).toBe(5 + siblings.filter((s) => s !== firstModel).length)
    expect(requested.some((u) => u.includes("/famille/optiques"))).toBe(false)
  })
})
