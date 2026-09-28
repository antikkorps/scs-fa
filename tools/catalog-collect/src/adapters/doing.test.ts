import { readFileSync } from "node:fs"
import { collectedProductSchema } from "@armurier/shared"
import { describe, expect, it } from "vitest"
import { PoliteClient } from "../http.js"
import { doingAdapter, parseCollections, parseDoingProduct, parseListingFragment, parsePageCount } from "./doing.js"

const fixture = (name: string) => readFileSync(new URL(`./fixtures/doing/${name}`, import.meta.url), "utf8")
const AGORA = "https://www.agora-tec.fr"

describe("Doing platform (Agora-Tec, Cor Caroli)", () => {
  it("reads the category menu as Brand > Collection", () => {
    const collections = parseCollections(fixture("home-menu.html"), AGORA)
    expect(collections[0]).toEqual({
      label: "AGORATEC > Couteaux pliants",
      url: `${AGORA}/les-articles.htm-reset-marque%3DAGORATEC-collection%3DCouteaux+pliants`,
    })
    expect(collections[1]?.label).toBe("ARCOS > Aiguisage (Fusils, pierres)")
  })

  it("reads the page count and the product links of a listing", () => {
    expect(parsePageCount(fixture("listing-benchmade-pliants.html"))).toBe(5)
    const urls = parseListingFragment(fixture("listing-fragment.html"), AGORA)
    expect(urls).toHaveLength(3)
    expect(urls.every((u) => u.startsWith(`${AGORA}/article.php-`))).toBe(true)
  })

  it("reads a product sheet: reference, name, brand, specs, images", () => {
    const p = parseDoingProduct(
      fixture("product-CS26SXP.html"),
      `${AGORA}/article.php-CS26SXP`,
      "COLDSTEEL > Couteaux pliants",
    )
    expect(p).toMatchObject({
      supplierSku: "CS26SXP",
      name: "Ti-Lite 6'' Zytel",
      brand: "Cold Steel",
      description: "Ti-Lite 6'' Zytel - Lame 152mm - Manche Zy-Ex - Clip",
      sourceCategory: "COLDSTEEL > Couteaux pliants",
      longDescription: "<p>Ouverture rapide en sortie de poche.</p>",
    })
    expect(p?.specs).toMatchObject({ Acier: "AUS8", "Longueur lame (mm)": "152", Port: "Clip" })
    expect(Object.keys(p?.specs ?? {})).toHaveLength(10)
    expect(p?.imageUrls).toHaveLength(5)
    expect(p?.imageUrls[0]).toBe(
      "https://www.agora-tec.fr/data/synchro/agoratec/local2web/articles/images/CS26SXP-1-z.jpg",
    )
    expect(collectedProductSchema.safeParse({ ...p, supplier: "Agora-Tec" }).success).toBe(true)
  })

  it("drops the '/' placeholder from the specifications", () => {
    const html = fixture("product-CS26SXP.html").replace("<b>Port</b> : Clip", "<b>Port</b> : /")
    expect(parseDoingProduct(html, `${AGORA}/article.php-CS26SXP`, undefined)?.specs.Port).toBeUndefined()
  })

  it("treats the '/' placeholder as no description, and ignores related products' images", () => {
    const p = parseDoingProduct(fixture("product-BN535.html"), `${AGORA}/article.php-BN535`, undefined)
    expect(p?.supplierSku).toBe("BN535")
    expect(p?.longDescription).toBeUndefined()
    expect(p?.imageUrls).toHaveLength(1)
    // Without a listing, the brand stands in for the category.
    expect(p?.sourceCategory).toBe(p?.brand)
  })

  it("repairs Cor Caroli's C1 apostrophes", () => {
    const p = parseDoingProduct(
      fixture("product-HHS403R.html"),
      "https://www.cor-caroli.fr/article.php-HHS403R",
      undefined,
    )
    expect(p).toMatchObject({ supplierSku: "HHS403R", name: "Holosun Red Dot 403R", brand: "Holosun" })
    expect(p?.longDescription).toContain("heures d’autonomie")
    expect(p?.longDescription).not.toMatch(/[\u0080-\u009f]/)
    expect(p?.specs["Type de réticule"]).toBe("Red Dot 2 MOA")
  })

  it("returns null for a page that is not a product", () => {
    expect(parseDoingProduct("<html><body>Plan du site</body></html>", `${AGORA}/plan_site.php`, undefined)).toBeNull()
  })

  it("discovers within the scope only, keeping the session between filter and pages", async () => {
    const requested: string[] = []
    const cookies: (string | null)[] = []
    const site: Record<string, string> = {
      [`${AGORA}/`]: fixture("home-menu.html"),
      [`${AGORA}/les-articles.htm-reset-marque%3DAGORATEC-collection%3DCouteaux+pliants`]:
        "<script>num_page_courante < 1</script>",
      [`${AGORA}/les-articles.htm/liste_article/page/0`]: fixture("listing-fragment.html"),
    }
    const client = new PoliteClient({
      cookies: true,
      minIntervalMs: 0,
      sleep: async () => {},
      fetch: async (url, init) => {
        requested.push(url)
        cookies.push(new Headers(init?.headers).get("cookie"))
        const body = site[url]
        return new Response(body ?? "", {
          status: body === undefined ? 404 : 200,
          headers: { "set-cookie": "PHPSESSID=s1; path=/" },
        })
      },
    })
    const adapter = doingAdapter({ id: "agora-tec", supplier: "Agora-Tec", origin: AGORA })
    const urls: string[] = []
    for await (const url of adapter.discover(client, { filters: ["couteaux pliants"] })) urls.push(url)

    expect(urls).toHaveLength(3)
    // ARCOS collections are out of scope: never requested.
    expect(requested.some((u) => u.includes("ARCOS"))).toBe(false)
    expect(cookies.at(-1)).toBe("PHPSESSID=s1")
  })
})
