import { CATALOG_SUPPLIERS } from "@armurier/shared"
// ESP France (www.espfrance.com) — PrestaShop 1.4, no structured data.
//
// Coverage is PARTIAL BY DESIGN. robots.txt forbids `/*p=`, i.e. every
// listing page after the first (`category.php?id_category=N&p=2`), and we do
// not work around it. What we can read:
// - the sitemap robots.txt declares (`Sitemap : …`, stale — 2011-2014 — but
//   thousands of `product.php?id_product=N`, many still online);
// - the FIRST page of every category, which catches recent products.
// A product missing from both is added by hand in the triage workbook.
//
// Categories come from the left-column tree (the only place showing the
// hierarchy) plus the few that only the top menu links to.

import type { CollectedProduct } from "@armurier/shared"
import * as cheerio from "cheerio"
import { type CollectScope, inScope, type SupplierAdapter } from "../adapter.js"
import { absoluteUrl, cleanText, fixC1, parseSitemap, unique } from "../extract.js"
import type { PoliteClient } from "../http.js"
import { breadcrumbPath, originalImageUrl } from "./prestashop.js"

const ORIGIN = "https://www.espfrance.com"

/** `…/product.php?id_product=N&…`, http or https, as one canonical URL. */
export function espProductUrl(href: string | undefined): string | undefined {
  const url = absoluteUrl(href, ORIGIN)
  if (!url) return undefined
  const { hostname, pathname, searchParams } = new URL(url)
  const id = searchParams.get("id_product")
  if (!/(^|\.)espfrance\.com$/.test(hostname) || pathname !== "/product.php" || !id || !/^\d+$/.test(id)) {
    return undefined
  }
  return `${ORIGIN}/product.php?id_product=${id}`
}

export interface EspCategory {
  url: string
  label: string
  /** Labels from the top of the tree down to this category. */
  path: string[]
}

/** Only ever `category.php?id_category=N`: no paging, sorting or filter parameter can slip in. */
function categoryUrl(href: string | undefined): string | undefined {
  const url = absoluteUrl(href, ORIGIN)
  const id = url ? new URL(url).searchParams.get("id_category") : null
  return id && /^[1-9]\d*$/.test(id) ? `${ORIGIN}/category.php?id_category=${id}` : undefined
}

export function parseEspCategories(html: string): EspCategory[] {
  const $ = cheerio.load(html)
  const byUrl = new Map<string, EspCategory>()
  const visit = (ul: ReturnType<typeof $>, parents: string[]) => {
    ul.children("li").each((_, li) => {
      const a = $(li).children("a").first()
      const url = categoryUrl(a.attr("href"))
      const label = cleanText(a.text())
      if (!url || !label) return
      const path = [...parents, label]
      if (!byUrl.has(url)) byUrl.set(url, { url, label, path })
      visit($(li).children("ul"), path)
    })
  }
  visit($("#categories_block_left ul.tree").first(), [])
  $('#menu a[href*="id_category="]').each((_, a) => {
    const url = categoryUrl($(a).attr("href"))
    const label = cleanText($(a).text()) ?? cleanText($(a).attr("title"))
    if (url && label && !byUrl.has(url)) byUrl.set(url, { url, label, path: [label] })
  })
  return [...byUrl.values()]
}

/** A category is in scope when its label, or one of its parents', is. */
export function espCategoryInScope(scope: CollectScope, category: EspCategory): boolean {
  return inScope(scope, category.path.join(" > ")) || category.path.some((l) => inScope(scope, l))
}

export function parseEspListing(html: string): string[] {
  const $ = cheerio.load(html)
  return unique(
    $("ul#product_list li.ajax_block_product")
      .map((_, li) => $(li).find("a.product_img_link[href], h3 a[href]").first().attr("href"))
      .get()
      .map(espProductUrl)
      .filter((u): u is string => Boolean(u)),
  )
}

const text = (value: string | undefined) => {
  const t = cleanText(value)
  return t ? fixC1(t) : undefined
}

/**
 * Some descriptions were pasted from Google Translate with its widget around
 * them: keep the translated text as a paragraph, drop the empty placeholder.
 */
function cleanDescription(html: string): string {
  const $ = cheerio.load(`<div id="x">${html}</div>`)
  $("#x .tw-target-rmn, #x .tw-data-placeholder").remove()
  $("#x .tw-ta-container").each((_, box) => {
    const pre = $(box).find("pre.tw-data-text").first()
    $(box).replaceWith(pre.length > 0 ? `<p>${pre.html() ?? ""}</p>` : "")
  })
  return ($("#x").html() ?? "").trim()
}

export function parseEspProduct(
  html: string,
  url: string,
  category: string | undefined,
): Omit<CollectedProduct, "supplier"> | null {
  const $ = cheerio.load(html)
  const ref =
    text($("#product_reference span.editable").first().text()) ??
    text(html.match(/var productReference\s*=\s*'((?:[^'\\]|\\.)*)'/)?.[1]?.replace(/\\(.)/g, "$1"))
  // The <title> is often shortened: the heading is the product's real name.
  const name = text($("#primary_block h1").first().text())
  if (!ref || !name) return null

  const productId = new URL(url).searchParams.get("id_product") ?? undefined
  const imageUrls = unique(
    $("#thumbs_list_frame li a.thickbox[href], #bigpic[src]")
      .map((_, el) => $(el).attr("href") ?? $(el).attr("src"))
      .get()
      .map((href) => {
        // `/img/p/{id_product}-{id_image}-thickbox.jpg` → the 1800 px original.
        const m = href.match(/\/img\/p\/(\d+)-(\d+)-[a-z_]+\.jpe?g$/i)
        return m ? originalImageUrl(ORIGIN, m[2] as string, m[1] ?? productId) : absoluteUrl(href, url)
      })
      .filter((u): u is string => Boolean(u)),
  ).slice(0, 50)

  const descriptionHtml = cleanDescription($("#idTab1.rte").first().html() ?? "")
  const hasText = Boolean(cleanText(cheerio.load(descriptionHtml).text()))

  const crumb = $("div.breadcrumb").first()
  const crumbs = [
    ...crumb
      .children("a")
      .map((_, a) => cleanText($(a).text()) ?? "")
      .get(),
    cleanText(crumb.contents().last().text()) ?? "",
  ]

  return {
    supplierSku: ref,
    name,
    brand: text($("#product_manufacturer span").first().text()),
    longDescription: hasText ? fixC1(descriptionHtml) : undefined,
    specs: {},
    imageUrls,
    sourceCategory: breadcrumbPath(crumbs.map((c) => fixC1(c))) ?? category,
    // "Vente Libre", "Arme Réglementée *" (the star points to a legal notice).
    supplierLegalClass: text($("#product_categoryRegle span.editable").first().text())?.replace(/\s*\*+$/, ""),
    sourceUrl: url,
  }
}

async function* sitemapProducts(client: PoliteClient, sitemaps: string[], seen: Set<string>): AsyncGenerator<string> {
  const read = new Set<string>()
  const queue = [...sitemaps]
  while (queue.length > 0) {
    const sitemap = queue.shift() as string
    if (read.has(sitemap)) continue
    read.add(sitemap)
    const { kind, urls } = parseSitemap(await client.get(sitemap))
    if (kind === "index") queue.push(...urls)
    else
      for (const url of urls.map(espProductUrl)) {
        if (!url || seen.has(url)) continue
        seen.add(url)
        yield url
      }
  }
}

export const esp: SupplierAdapter = (() => {
  const categoryOf = new Map<string, string>()
  return {
    id: "esp-france",
    supplier: CATALOG_SUPPLIERS.espFrance,
    origin: ORIGIN,
    async *discover(client: PoliteClient, scope: CollectScope) {
      const seen = new Set<string>()
      const all = scope.filters.length === 0
      if (all) {
        const declared = await client.declaredSitemaps(ORIGIN)
        yield* sitemapProducts(client, declared.length > 0 ? declared : [`${ORIGIN}/sitemap/google-SiteMap.xml`], seen)
      }
      const categories = parseEspCategories(await client.get(`${ORIGIN}/`))
      for (const category of categories) {
        if (!all && !espCategoryInScope(scope, category)) continue
        // First page only: robots.txt forbids `p=`.
        for (const url of parseEspListing(await client.get(category.url))) {
          if (!categoryOf.has(url)) categoryOf.set(url, category.path.join(" > "))
          if (seen.has(url)) continue
          seen.add(url)
          yield url
        }
      }
    },
    parse(html, url) {
      const product = parseEspProduct(html, url, categoryOf.get(url))
      return product ? { ...product, supplier: CATALOG_SUPPLIERS.espFrance } : null
    },
  }
})()
