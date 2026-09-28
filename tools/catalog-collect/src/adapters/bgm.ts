// BGM Winfield (bgmwinfield.fr) — PrestaShop 8, no robots.txt, no sitemap.
//
// - Every product sits under the root category `/2-accueil` (100 per page,
//   `rel="next"` pagination): that is the full-catalogue walk. A scoped run
//   walks the matching menu categories instead.
// - Product pages carry a schema.org Product in JSON-LD (reference, name,
//   brand, every image). No short description and no feature table: the
//   specifications are written inside the description.

import type { CollectedProduct } from "@armurier/shared"
import * as cheerio from "cheerio"
import { type CollectScope, inScope, type SupplierAdapter } from "../adapter.js"
import { absoluteUrl, cleanText, jsonLdOfType, ldImages, ldText, unique } from "../extract.js"
import type { PoliteClient } from "../http.js"
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
    sourceUrl: url,
  }
}

export const bgmWinfield: SupplierAdapter = {
  id: "bgm-winfield",
  supplier: "BGM Winfield",
  origin: ORIGIN,
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
    return product ? { ...product, supplier: "BGM Winfield" } : null
  },
}
