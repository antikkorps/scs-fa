import { readFileSync } from "node:fs"
import { collectedProductSchema } from "@armurier/shared"
import { describe, expect, it } from "vitest"
import { PoliteClient } from "../http.js"
import {
  corCaroli,
  doingAdapter,
  isSignedIn,
  legalClassFromSpecs,
  parseCollections,
  parseDoingProduct,
  parseListingFragment,
  parsePageCount,
  parsePurchasePrice,
} from "./doing.js"

const fixture = (name: string) => readFileSync(new URL(`./fixtures/doing/${name}`, import.meta.url), "utf8")
const AGORA = "https://www.agora-tec.fr"

describe("Doing platform (Agora-Tec, Cor Caroli)", () => {
  it("reads the category menu as Brand > Collection", () => {
    const collections = parseCollections(fixture("home-menu.html"), AGORA)
    expect(collections[0]).toEqual({
      label: "MARQUEF > Couteaux pliants",
      url: `${AGORA}/les-articles.htm-reset-marque%3DMARQUEF-collection%3DCouteaux+pliants`,
    })
    expect(collections[1]?.label).toBe("MARQUEG > Aiguisage (Fusils, pierres)")
  })

  it("reads the page count and the product links of a listing", () => {
    expect(parsePageCount(fixture("listing-pliants.html"))).toBe(5)
    const urls = parseListingFragment(fixture("listing-fragment.html"), AGORA)
    expect(urls).toHaveLength(3)
    expect(urls.every((u) => u.startsWith(`${AGORA}/article.php-`))).toBe(true)
  })

  it("reads a product sheet: reference, name, brand, specs, images", () => {
    const p = parseDoingProduct(
      fixture("product-REFC001.html"),
      `${AGORA}/article.php-REFC001`,
      "MARQUEC > Couteaux pliants",
    )
    expect(p).toMatchObject({
      supplierSku: "REFC001",
      name: "Couteau exemple 6''",
      brand: "Marque Gamma",
      description: "Couteau exemple 6'' - Lame 152mm - Manche Polymère - Clip",
      sourceCategory: "MARQUEC > Couteaux pliants",
      longDescription: "<p>Ouverture rapide en sortie de poche.</p>",
    })
    expect(p?.specs).toMatchObject({ Acier: "AUS8", "Longueur lame (mm)": "152", Port: "Clip" })
    expect(Object.keys(p?.specs ?? {})).toHaveLength(10)
    expect(p?.imageUrls).toHaveLength(5)
    expect(p?.imageUrls[0]).toBe(
      "https://www.agora-tec.fr/data/synchro/agoratec/local2web/articles/images/REFC001-1-z.jpg",
    )
    expect(collectedProductSchema.safeParse({ ...p, supplier: "Agora-Tec" }).success).toBe(true)
  })

  it("drops the '/' placeholder from the specifications", () => {
    const html = fixture("product-REFC001.html").replace("<b>Port</b> : Clip", "<b>Port</b> : /")
    expect(parseDoingProduct(html, `${AGORA}/article.php-REFC001`, undefined)?.specs.Port).toBeUndefined()
  })

  it("treats the '/' placeholder as no description, and ignores related products' images", () => {
    const p = parseDoingProduct(fixture("product-REFE001.html"), `${AGORA}/article.php-REFE001`, undefined)
    expect(p?.supplierSku).toBe("REFE001")
    expect(p?.longDescription).toBeUndefined()
    expect(p?.imageUrls).toHaveLength(1)
    // Without a listing, the brand stands in for the category.
    expect(p?.sourceCategory).toBe(p?.brand)
  })

  it("repairs Cor Caroli's C1 apostrophes", () => {
    const p = parseDoingProduct(
      fixture("product-REFD001.html"),
      "https://www.cor-caroli.fr/article.php-REFD001",
      undefined,
    )
    expect(p).toMatchObject({ supplierSku: "REFD001", name: "Point rouge exemple D1", brand: "Marque Delta" })
    expect(p?.longDescription).toContain("Exemple d’autonomie")
    expect(p?.longDescription).not.toMatch(/[\u0080-\u009f]/)
    expect(p?.specs["Type de réticule"]).toBe("Red Dot 2 MOA")
  })

  it("keeps the supplier's legal class, whichever way the platform spells its label", () => {
    expect(legalClassFromSpecs({ "Catégorie d_arme": "B1" })).toBe("B1")
    expect(legalClassFromSpecs({ "Catégorie d arme": "C 1°-b)" })).toBe("C 1°-b)")
    expect(legalClassFromSpecs({ "Catégorie d’arme": " D " })).toBe("D")
  })

  it("reads no legal class from the '_' placeholder or a sheet without one", () => {
    expect(legalClassFromSpecs({ "Catégorie d_arme": "_" })).toBeUndefined()
    expect(legalClassFromSpecs({ Calibre: "9x19" })).toBeUndefined()
  })

  it("reads our price from a signed-in page, and only from one", () => {
    const url = "https://www.cor-caroli.fr/article.php-REFD001"
    const pro = fixture("product-REFD001-pro.html")
    expect(parseDoingProduct(pro, url, undefined)).toMatchObject({ supplierSku: "REFD001", purchasePrice: 1105.7 })
    expect(parseDoingProduct(fixture("product-REFD001.html"), url, undefined)?.purchasePrice).toBeUndefined()
    expect(parsePurchasePrice(pro.replace("bandeau_deconnexion", "autre_bouton"))).toBeUndefined()
  })

  it("accepts listing fragments, which carry no header, as signed in", () => {
    expect(isSignedIn("<li>…</li>", "https://www.cor-caroli.fr/les-articles.htm/liste_article/page/0")).toBe(true)
    expect(isSignedIn(fixture("product-REFD001.html"), "https://www.cor-caroli.fr/article.php-REFD001")).toBe(false)
  })

  it("signs in through the header form, without retrying a refusal", async () => {
    const posts: string[] = []
    const client = new PoliteClient({
      minIntervalMs: 0,
      sleep: async () => {},
      cookies: true,
      fetch: async (url, init) => {
        if (url.endsWith("/robots.txt")) return new Response("", { status: 404 })
        posts.push(String(init?.body))
        return new Response(fixture("product-REFD001.html"))
      },
    })
    await expect(corCaroli.proLogin?.signIn(client, { login: "C12345", password: "pw" })).rejects.toThrow(
      /refused the sign-in/,
    )
    expect(posts).toHaveLength(1)
    expect(new URLSearchParams(posts[0])).toEqual(
      new URLSearchParams({ szModeAuth_PM: "connexion", szLoginAuth_PM: "C12345", szPasswordAuth_PM: "pw" }),
    )
  })

  it("returns null for a page that is not a product", () => {
    expect(parseDoingProduct("<html><body>Plan du site</body></html>", `${AGORA}/plan_site.php`, undefined)).toBeNull()
  })

  it("discovers within the scope only, keeping the session between filter and pages", async () => {
    const requested: string[] = []
    const cookies: (string | null)[] = []
    const site: Record<string, string> = {
      [`${AGORA}/`]: fixture("home-menu.html"),
      [`${AGORA}/les-articles.htm-reset-marque%3DMARQUEF-collection%3DCouteaux+pliants`]:
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
    // MARQUEG collections are out of scope: never requested.
    expect(requested.some((u) => u.includes("MARQUEG"))).toBe(false)
    expect(cookies.at(-1)).toBe("PHPSESSID=s1")
  })
})
