// Helpers shared by the PrestaShop suppliers (BGM Winfield, Toro, ESP France).

import * as cheerio from "cheerio"
import { cleanText } from "../extract.js"

/**
 * The ORIGINAL upload of a PrestaShop image. The largest "thumbnail" types
 * (product_main_2x, zoom_product) are upscaled from it on BGM and Toro, so the
 * original is both sharper and lighter.
 *
 * - PrestaShop ≥ 1.5 stores it at `/img/p/1/4/1/8/3/14183.jpg` (one folder per digit);
 * - PrestaShop 1.4 (ESP) at `/img/p/{id_product}-{id_image}.jpg`.
 */
export function originalImageUrl(origin: string, idImage: string | number, legacyProductId?: string | number): string {
  const id = String(idImage)
  if (legacyProductId !== undefined) return `${origin}/img/p/${legacyProductId}-${id}.jpg`
  return `${origin}/img/p/${id.split("").join("/")}/${id}.jpg`
}

/** The image id of a friendly image URL such as `/14183-product_main_2x/slug.jpg`. */
export function imageIdFromUrl(url: string): string | undefined {
  return url.match(/\/(\d+)-[a-z0-9_]+\/[^/]+\.(?:jpe?g|png|webp)$/i)?.[1]
}

/** JSON-LD strings on PrestaShop are HTML-escaped (`B&amp;T`, `14.5&#039;`). */
export function unescapeHtml(text: string | undefined): string | undefined {
  if (text === undefined) return undefined
  return cleanText(cheerio.load(`<p>${text}</p>`)("p").text())
}

/** Breadcrumb labels, "Accueil" and the product itself left out. */
export function breadcrumbPath(labels: string[]): string | undefined {
  const inner = labels
    .slice(1, -1)
    .map((l) => l.trim())
    .filter(Boolean)
  return inner.length > 0 ? inner.join(" > ") : undefined
}
