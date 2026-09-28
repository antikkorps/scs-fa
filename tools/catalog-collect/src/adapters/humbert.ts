// Humbert (www.humbert.com) — Symfony site, no robots.txt, no sitemap, no
// structured data; everything is in the server-rendered HTML.
//
// - Families (`/fr/famille/<slug>`) list MODELS, 24 at a time; the next batch
//   comes from `/fr/famille/{id}/page/{n}/{ordre}` (JSON `{ html }`), whose
//   parameters sit on the "Voir plus" button of the previous batch.
// - A model card links to ONE of its articles; that article's page lists all
//   the others ("Autres articles associés au modèle") — so discovery reads
//   each model page once (cached, the runner re-reads it from disk).
// - Each article carries Humbert's own legal classification ("Catégorie
//   d'Arme": C1b, B2abis…), kept as a hint for the human, never as the answer.

import type { CollectedProduct } from "@armurier/shared"
import * as cheerio from "cheerio"
import { type CollectScope, inScope, type SupplierAdapter } from "../adapter.js"
import { absoluteUrl, cleanText, unique } from "../extract.js"
import type { PoliteClient } from "../http.js"

const ORIGIN = "https://www.humbert.com"

export interface Family {
  label: string
  url: string
}

export function parseFamilies(html: string): Family[] {
  const $ = cheerio.load(html)
  const byUrl = new Map<string, string>()
  $('a[href^="/fr/famille/"]').each((_, el) => {
    const href = $(el).attr("href") ?? ""
    const label = cleanText($(el).text())
    // Filtered variants (?filtre_type[]=…) and "Voir tout" links are not families.
    if (!/^\/fr\/famille\/[a-z-]+$/.test(href) || !label || /voir tout/i.test(label)) return
    if (!byUrl.has(href)) byUrl.set(href, label)
  })
  return [...byUrl].map(([href, label]) => ({ label, url: `${ORIGIN}${href}` }))
}

export interface ListingBatch {
  productUrls: string[]
  next: { famille: string; page: string; ordre: string } | null
}

export function parseListing(html: string): ListingBatch {
  const $ = cheerio.load(html)
  const productUrls = unique(
    $('.cardVignetteProduit a.cardImgProduit[href^="/fr/produit/"]')
      .map((_, a) => absoluteUrl($(a).attr("href"), ORIGIN))
      .get()
      .filter((u): u is string => Boolean(u)),
  )
  const btn = $("button.btnFamilleVoirPlus").first()
  const [famille, page, ordre] = ["data-famille", "data-page", "data-ordrepushpromo"].map((a) => btn.attr(a))
  return { productUrls, next: famille && page && ordre ? { famille, page, ordre } : null }
}

/** The other articles of the same model, listed on an article's page. */
export function parseSiblings(html: string): string[] {
  const $ = cheerio.load(html)
  return unique(
    $('.containerAutresArticles a.cardImgProduit[href^="/fr/produit/"]')
      .map((_, a) => absoluteUrl($(a).attr("href"), ORIGIN))
      .get()
      .filter((u): u is string => Boolean(u)),
  )
}

const IGNORED_LABELS = new Set(["réf.", "prix ttc", "marque", "catégorie", "catégorie d'arme"])

export function parseHumbertProduct(
  html: string,
  url: string,
  family: string | undefined,
): Omit<CollectedProduct, "supplier"> | null {
  const $ = cheerio.load(html)
  const ref = cleanText($("span.refProduit").first().text())
  const name = cleanText($(".headerProduit h1").first().text())
  if (!ref || !name) return null

  // "Label / value" pairs of the details block.
  const details = new Map<string, string>()
  $(".blocDetailsProduit li h3").each((_, h3) => {
    const label = cleanText($(h3).find("span.robotoBold").first().text())
    const value = cleanText($(h3).find("span.robotoRegular").first().text())
    if (label && value) details.set(label, value)
  })
  const get = (label: string) => [...details].find(([k]) => k.toLowerCase() === label)?.[1]

  const specs: Record<string, string> = {}
  for (const [label, value] of details) if (!IGNORED_LABELS.has(label.toLowerCase())) specs[label] = value
  // The desktop info block: 1st column = description, 2nd = specifications.
  const columns = $(".blocInfosProduit.d-md-flex .colInfosProduit")
  columns
    .eq(1)
    .find("li.list-group-item")
    .each((_, li) => {
      const label = cleanText($(li).find("strong").text())?.replace(/\s*:\s*$/, "")
      const value = cleanText($(li).clone().children("strong").remove().end().text())
      if (label && value) specs[label] = value
    })

  const descriptionHtml = columns.eq(0).find(".listInfosProduit").html()?.trim()
  const hasText = Boolean(cleanText(cheerio.load(descriptionHtml ?? "").text()))

  const imageUrls = unique(
    $("#sync1 .item img")
      .map((_, img) => absoluteUrl($(img).attr("src"), url))
      .get()
      .filter((u): u is string => Boolean(u)),
  )

  const category = get("catégorie")
  return {
    supplierSku: ref,
    name,
    brand: get("marque"),
    longDescription: hasText ? descriptionHtml : undefined,
    specs,
    imageUrls,
    sourceCategory: [family, category].filter(Boolean).join(" > ") || undefined,
    supplierLegalClass: get("catégorie d'arme"),
    sourceUrl: url,
  }
}

export const humbert: SupplierAdapter = (() => {
  const familyOf = new Map<string, string>()
  return {
    id: "humbert",
    supplier: "Humbert",
    origin: ORIGIN,
    async *discover(client: PoliteClient, scope: CollectScope) {
      const families = parseFamilies(await client.get(`${ORIGIN}/fr/`))
      const seen = new Set<string>()
      for (const family of families) {
        if (!inScope(scope, family.label)) continue
        let batch = parseListing(await client.get(family.url))
        for (;;) {
          for (const modelUrl of batch.productUrls) {
            // The model page lists its siblings; it is cached, so the runner's
            // own read of it costs nothing.
            for (const url of [modelUrl, ...parseSiblings(await client.get(modelUrl))]) {
              if (seen.has(url)) continue
              seen.add(url)
              familyOf.set(url, family.label)
              yield url
            }
          }
          if (!batch.next) break
          const { famille, page, ordre } = batch.next
          const json = await client.get(`${ORIGIN}/fr/famille/${famille}/page/${page}/${ordre}`)
          batch = parseListing((JSON.parse(json) as { html?: string }).html ?? "")
        }
      }
    },
    parse(html, url) {
      const product = parseHumbertProduct(html, url, familyOf.get(url))
      return product ? { ...product, supplier: "Humbert" } : null
    },
  }
})()
