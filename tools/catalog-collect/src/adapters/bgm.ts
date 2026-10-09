// BGM Winfield (bgmwinfield.fr) — PrestaShop 8, no robots.txt, no sitemap.
//
// - Every product sits under the root category `/2-accueil` (100 per page,
//   `rel="next"` pagination): that is the full-catalogue walk. A scoped run
//   walks the matching menu categories instead.
// - Product pages carry a schema.org Product in JSON-LD (reference, name,
//   brand, every image). No short description and no feature table: the
//   specifications are written inside the description.
// - Pro area: signed in, a product page shows OUR purchase price excl. VAT
//   (plus the supplier's resale coefficient, not kept). Signed out, it shows
//   no price block at all — the public price only lives in the JSON-LD, which
//   is why the purchase price is never read from there.

import { CATALOG_SUPPLIERS, type CollectedProduct, parseBankAmount } from "@armurier/shared"
import * as cheerio from "cheerio"
import { type CollectScope, inScope, type ProLogin, type SupplierAdapter } from "../adapter.js"
import { absoluteUrl, cleanText, jsonLdOfType, ldImages, ldText, unique } from "../extract.js"
import { type PoliteClient, SessionLostError } from "../http.js"
import { breadcrumbPath, imageIdFromUrl, originalImageUrl, unescapeHtml } from "./prestashop.js"

const ORIGIN = "https://bgmwinfield.fr"
const ROOT_CATEGORY = `${ORIGIN}/2-accueil`

export function parseCategories(html: string): { label: string; url: string }[] {
  const $ = cheerio.load(html)
  const byUrl = new Map<string, string>()
  $("a[href]").each((_, a) => {
    const url = absoluteUrl($(a).attr("href"), ORIGIN)
    const label = cleanText($(a).text())
    if (!url || !label || !/^https:\/\/bgmwinfield\.fr\/\d+-[a-z0-9-]+$/.test(url) || url === ROOT_CATEGORY) return
    if (!byUrl.has(url)) byUrl.set(url, label)
  })
  return [...byUrl].map(([url, label]) => ({ label, url }))
}

export function parseListingPage(html: string): { productUrls: string[]; next: string | undefined } {
  const $ = cheerio.load(html)
  const productUrls = unique(
    $("article.js-product-miniature a.product-link")
      .map((_, a) => absoluteUrl($(a).attr("href"), ORIGIN))
      .get()
      .filter((u): u is string => Boolean(u)),
  )
  return { productUrls, next: absoluteUrl($('a.js-pager-link[rel="next"]').attr("href"), ORIGIN) }
}

/** PrestaShop tells its own front-end whether the visitor is signed in. */
export function isSignedIn(html: string): boolean {
  return /"is_logged"\s*:\s*true/.test(html)
}

/**
 * Our purchase price, excl. VAT, as the pro area prints it. Only read when the
 * page was served signed in AND labels the price "HT": anything else could be
 * a public, VAT-inclusive price, and a wrong cost is worse than none.
 */
export function parsePurchasePrice(html: string): number | undefined {
  if (!isSignedIn(html)) return undefined
  const $ = cheerio.load(html)
  const prices = $(".product__prices").first()
  if (cleanText(prices.find(".product__tax-label").first().text())?.toUpperCase() !== "HT") return undefined
  const amount = parseBankAmount(prices.find(".product__current-price").first().text())
  return Number.isFinite(amount) && amount > 0 ? amount : undefined
}

export function parseBgmProduct(html: string, url: string): Omit<CollectedProduct, "supplier"> | null {
  const $ = cheerio.load(html)
  const ld = jsonLdOfType($, "Product")
  const offers = ld?.offers && typeof ld.offers === "object" && !Array.isArray(ld.offers) ? ld.offers : undefined
  const ref = unescapeHtml(ldText(ld?.sku) ?? $(".item__reference .item-content span").first().text())
  const name = unescapeHtml(ldText(ld?.name) ?? $("h1.product__name").first().text())
  if (!ref || !name) return null

  // The originals, not the 1440 px upscales the JSON-LD points to.
  const imageUrls = unique(
    ldImages(offers?.image ?? ld?.image)
      .map((src) => {
        const id = imageIdFromUrl(src)
        return id ? originalImageUrl(ORIGIN, id) : absoluteUrl(src, url)
      })
      .filter((u): u is string => Boolean(u)),
  )

  const description = $(".product-informations__item")
    .filter((_, item) => /description/i.test($(item).find(".item-label").text()))
    .first()
    .find(".item-content")
    .html()
    ?.trim()

  const crumbs = $("ol.breadcrumb li")
    .map((_, li) => cleanText($(li).text()))
    .get()
    .filter((c): c is string => Boolean(c))

  return {
    supplierSku: ref,
    name,
    brand: unescapeHtml(ldText(ld?.brand)),
    longDescription: description && cleanText(cheerio.load(description).text()) ? description : undefined,
    specs: {},
    imageUrls,
    sourceCategory: breadcrumbPath(crumbs) ?? unescapeHtml(ldText(ld?.category)),
    purchasePrice: parsePurchasePrice(html),
    sourceUrl: url,
  }
}

const proLogin: ProLogin = {
  envPrefix: "BGM",
  async signIn(client, { login, password }) {
    await client.postForm(`${ORIGIN}/connexion?back=my-account`, {
      back: "my-account",
      email: login,
      password,
      submitLogin: "1",
    })
    // The landing page can be a CDN copy: ask the account page itself.
    const account = await client.get(`${ORIGIN}/mon-compte`, { cache: false }).catch((err: unknown) => {
      if (err instanceof SessionLostError) return ""
      throw err
    })
    if (!isSignedIn(account)) {
      throw new Error("BGM Winfield refused the sign-in (check BGM_LOGIN / BGM_PASSWORD); not retried")
    }
  },
  isSignedIn,
}

export const bgmWinfield: SupplierAdapter = {
  id: "bgm-winfield",
  supplier: CATALOG_SUPPLIERS.bgmWinfield,
  origin: ORIGIN,
  proLogin,
  async *discover(client: PoliteClient, scope: CollectScope) {
    const starts =
      scope.filters.length === 0
        ? [ROOT_CATEGORY]
        : parseCategories(await client.get(ROOT_CATEGORY))
            .filter((c) => inScope(scope, c.label))
            .map((c) => c.url)
    const seen = new Set<string>()
    for (const start of starts) {
      for (let page: string | undefined = start; page; ) {
        // Listings change as stock moves: never served from the cache.
        const listing = parseListingPage(await client.get(page, { cache: false }))
        for (const url of listing.productUrls) {
          if (seen.has(url)) continue
          seen.add(url)
          yield url
        }
        page = listing.next && listing.next !== page ? listing.next : undefined
      }
    }
  },
  parse(html, url) {
    const product = parseBgmProduct(html, url)
    return product ? { ...product, supplier: CATALOG_SUPPLIERS.bgmWinfield } : null
  },
}
