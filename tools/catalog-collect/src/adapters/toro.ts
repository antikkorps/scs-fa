// Toro Distribution (www.toro-distribution.com) — PrestaShop 1.7.
//
// - The whole catalogue: the sitemap index declared in robots.txt
//   (`1_index_sitemap.xml` → `1_fr_0_sitemap.xml`, `<loc>` wrapped in CDATA).
//   Products are `/{id}-{slug}.html`, categories `/{id}-{slug}`.
// - Part of it: the categories of the header megamenu whose label is in scope,
//   walked `?page=N` (allowed; `?order=`, `?n=`… are not) and down through
//   their subcategories — a parent category lists no product of its own.
// - A product page carries everything in `#product-details[data-product]`
//   (the product as JSON). Pack contents and purchase prices sit there too:
//   they are never read. Combinations (sizes…) are not separate products:
//   they are summed up in one "Déclinaisons" spec.

import { CATALOG_SUPPLIERS, type CollectedProduct, normaliseEan } from "@armurier/shared"
import * as cheerio from "cheerio"
import { type CollectScope, inScope, type SupplierAdapter } from "../adapter.js"
import { absoluteUrl, cleanText, fixC1, htmlToText, parseSitemap, truncate, unique } from "../extract.js"
import type { PoliteClient } from "../http.js"
import { breadcrumbPath, imageIdFromUrl, originalImageUrl } from "./prestashop.js"

const ORIGIN = "https://www.toro-distribution.com"
const PRODUCT_URL = /^https:\/\/www\.toro-distribution\.com\/\d+-[^/?#]+\.html$/
const CATEGORY_URL = /^https:\/\/www\.toro-distribution\.com\/\d+-[^/?#.]+$/

export function isToroProductUrl(url: string): boolean {
  return PRODUCT_URL.test(url)
}

export interface ToroCategory {
  /** Menu path, e.g. "Airsoft > Répliques > Répliques de Poing". */
  label: string
  url: string
}

/** Category links of the header megamenu, each with its universe and block. */
export function parseToroMenu(html: string): ToroCategory[] {
  const $ = cheerio.load(html)
  const byUrl = new Map<string, string>()
  $(".ets_mm_megamenu li.mm_menus_li").each((_, universe) => {
    const top = cleanText($(universe).children("a").first().text())
    $(universe)
      .find("a[href]")
      .each((_, a) => {
        const url = absoluteUrl($(a).attr("href"), ORIGIN)
        const own = cleanText($(a).text())
        if (!url || !own || !CATEGORY_URL.test(url) || byUrl.has(url)) return
        const block = cleanText($(a).closest(".ets_mm_block").find(".ets_mm_block__title a").first().text())
        byUrl.set(url, unique([top, block, own].filter((l): l is string => Boolean(l))).join(" > "))
      })
  })
  return [...byUrl].map(([url, path]) => ({ label: path, url }))
}

export interface ToroListing {
  productUrls: string[]
  subcategories: ToroCategory[]
  hasNext: boolean
}

export function parseToroListing(html: string): ToroListing {
  const $ = cheerio.load(html)
  const productUrls = unique(
    $("article.js-product-miniature")
      .map((_, card) => $(card).find("a.product-thumbnail[href], .product-title a[href]").first().attr("href"))
      .get()
      .map((href) => absoluteUrl(href, ORIGIN))
      .filter((u): u is string => Boolean(u && PRODUCT_URL.test(u))),
  )
  const subcategories = $("#subcategories a.subcategory__link[href]")
    .map((_, a) => ({
      url: absoluteUrl($(a).attr("href"), ORIGIN),
      label: cleanText($(a).find(".subcategory__title").text()),
    }))
    .get()
    .filter((c): c is ToroCategory => Boolean(c.url && c.label && CATEGORY_URL.test(c.url)))
  const hasNext = $('link[rel="next"], a[rel="next"]').length > 0
  return { productUrls, subcategories, hasNext }
}

/**
 * A usable EAN, or undefined. Toro fills unknown codes with zero-padded
 * internal numbers (`0000000096164`): those are not GTINs, whatever their
 * check digit says.
 */
export function toroEan(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined
  const ean = normaliseEan(raw)
  return ean && !/^0{5}/.test(ean) ? ean : undefined
}

interface ToroImage {
  id_image?: number | string
  large?: { url?: string }
  bySize?: Record<string, { url?: string }>
}

interface ToroProductData {
  reference?: string
  name?: string
  manufacturer_name?: string
  description?: string
  description_short?: string
  category_name?: string
  ean13?: string
  id_product_attribute?: number | string
  features?: { name?: string; value?: string }[]
  images?: ToroImage[]
}

const str = (value: unknown) => (typeof value === "string" ? cleanText(fixC1(value)) : undefined)

export function parseToroProduct(
  html: string,
  url: string,
  category: string | undefined,
): Omit<CollectedProduct, "supplier"> | null {
  const $ = cheerio.load(html)
  // cheerio has already decoded the attribute's HTML entities.
  const raw = $("#product-details[data-product]").attr("data-product")
  if (!raw) return null
  let data: ToroProductData
  try {
    data = JSON.parse(raw) as ToroProductData
  } catch {
    return null
  }
  // `.product-reference` elsewhere on the page belongs to related-product cards.
  const ref = str(data.reference)
  const name = str(data.name)
  if (!ref || !name) return null

  // One feature can repeat ("Caractéristiques" ×10): values are joined. "-"
  // is the shop's "not applicable" placeholder.
  const specs: Record<string, string> = {}
  for (const f of data.features ?? []) {
    const key = str(f.name)
    const value = str(f.value)
    if (!key || !value || value === "-") continue
    specs[key] = specs[key] ? `${specs[key]}, ${value}` : value
  }
  const combinations = unique(
    $("#wk-combination-block-view .wk-combination-name")
      .map((_, el) => cleanText($(el).text()))
      .get()
      .filter((c): c is string => Boolean(c)),
  )
  if (combinations.length > 0) specs.Déclinaisons = combinations.join(", ")

  const imageUrls = unique(
    (data.images ?? [])
      .map((image) => {
        const fallback = image.large?.url ?? image.bySize?.large_default?.url
        const id = image.id_image ?? (fallback ? imageIdFromUrl(fallback) : undefined)
        return id !== undefined ? originalImageUrl(ORIGIN, id) : absoluteUrl(fallback, ORIGIN)
      })
      .filter((u): u is string => Boolean(u)),
  ).slice(0, 50)

  // The product's own EAN; the one shown under "references" is the default
  // combination's when there are combinations.
  const shownEan =
    combinations.length === 0 && Number(data.id_product_attribute ?? 0) === 0
      ? $(".product-features.references .data-sheet-item")
          .filter((_, item) => /ean/i.test($(item).find("dt").text()))
          .find("dd")
          .first()
          .text()
      : undefined

  const longDescription = data.description?.trim()
  const crumbs = $(".breadcrumb li")
    .map((_, li) => cleanText($(li).text()) ?? "")
    .get()

  return {
    supplierSku: ref,
    ean: toroEan(data.ean13) ?? toroEan(shownEan?.trim()),
    name,
    brand: str(data.manufacturer_name),
    description: truncate(htmlToText(fixC1(data.description_short ?? "")), 5000),
    longDescription: longDescription && htmlToText(longDescription) ? fixC1(longDescription) : undefined,
    specs,
    imageUrls,
    sourceCategory: breadcrumbPath(crumbs) ?? category ?? str(data.category_name),
    sourceUrl: url,
  }
}

async function* sitemapProducts(client: PoliteClient, sitemaps: string[]): AsyncGenerator<string> {
  const seen = new Set<string>()
  const queue = [...sitemaps]
  while (queue.length > 0) {
    const sitemap = queue.shift() as string
    if (seen.has(sitemap)) continue
    seen.add(sitemap)
    const { kind, urls } = parseSitemap(await client.get(sitemap))
    if (kind === "index") queue.push(...urls.filter((u) => u.startsWith(`${ORIGIN}/`)))
    else
      for (const url of urls) {
        if (!PRODUCT_URL.test(url) || seen.has(url)) continue
        seen.add(url)
        yield url
      }
  }
}

export const toro: SupplierAdapter = (() => {
  const categoryOf = new Map<string, string>()
  return {
    id: "toro-distribution",
    supplier: CATALOG_SUPPLIERS.toroDistribution,
    origin: ORIGIN,
    async *discover(client: PoliteClient, scope: CollectScope) {
      if (scope.filters.length === 0) {
        const declared = await client.declaredSitemaps(ORIGIN)
        yield* sitemapProducts(client, declared.length > 0 ? declared : [`${ORIGIN}/1_index_sitemap.xml`])
        return
      }
      const queue = parseToroMenu(await client.get(`${ORIGIN}/`)).filter((c) => inScope(scope, c.label))
      const visited = new Set<string>()
      const yielded = new Set<string>()
      while (queue.length > 0) {
        const category = queue.shift() as ToroCategory
        if (visited.has(category.url)) continue
        visited.add(category.url)
        for (let page = 1; ; page++) {
          const listing = parseToroListing(await client.get(page === 1 ? category.url : `${category.url}?page=${page}`))
          if (page === 1)
            queue.push(...listing.subcategories.map((s) => ({ url: s.url, label: `${category.label} > ${s.label}` })))
          const fresh = listing.productUrls.filter((u) => !yielded.has(u))
          for (const url of fresh) {
            yielded.add(url)
            categoryOf.set(url, category.label)
            yield url
          }
          // A parent category announces a next page but lists nothing.
          if (fresh.length === 0 || !listing.hasNext) break
        }
      }
    },
    parse(html, url) {
      const product = parseToroProduct(html, url, categoryOf.get(url))
      return product ? { ...product, supplier: CATALOG_SUPPLIERS.toroDistribution } : null
    },
  }
})()
