// Extraction helpers shared by every adapter. Structured data first — a
// schema.org Product in JSON-LD survives a theme redesign, a CSS selector does
// not — and small, well-tested text utilities for the rest.

import * as cheerio from "cheerio"

export { fixC1 } from "@armurier/shared"

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** Every JSON-LD node of a page, `@graph` containers and arrays flattened. */
export function jsonLdNodes($: cheerio.CheerioAPI): Record<string, Json>[] {
  const nodes: Record<string, Json>[] = []
  const visit = (value: Json) => {
    if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === "object") {
      nodes.push(value)
      if (Array.isArray(value["@graph"])) value["@graph"].forEach(visit)
    }
  }
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      visit(JSON.parse($(el).text()) as Json)
    } catch {
      // A malformed block is common and harmless: the next one may be fine.
    }
  })
  return nodes
}

const hasType = (node: Record<string, Json>, type: string) => {
  const t = node["@type"]
  return t === type || (Array.isArray(t) && t.includes(type))
}

export function jsonLdOfType($: cheerio.CheerioAPI, type: string): Record<string, Json> | null {
  return jsonLdNodes($).find((n) => hasType(n, type)) ?? null
}

/** A JSON-LD value as text: strings as-is, `{ name }` objects by name, arrays by first item. */
export function ldText(value: Json | undefined): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === "string") return value.trim() || undefined
  if (typeof value === "number") return String(value)
  if (Array.isArray(value)) return ldText(value[0])
  if (typeof value === "object") return ldText(value.name ?? value["@value"])
  return undefined
}

/** Image URLs of a JSON-LD `image` field (string, object or array of either). */
export function ldImages(value: Json | undefined): string[] {
  if (!value) return []
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(ldImages)
  if (typeof value === "object") return ldImages(value.url ?? value.contentUrl)
  return []
}

/** Resolve a possibly relative URL; drop anything that is not http(s). */
export function absoluteUrl(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined
  try {
    const url = new URL(href.trim(), base)
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined
  } catch {
    return undefined
  }
}

/** Unique values, first occurrence kept — image lists often repeat the cover. */
export function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

/** Collapse whitespace; decode nothing (cheerio already did). */
export function cleanText(text: string | undefined): string | undefined {
  const t = text?.replace(/\s+/g, " ").trim()
  return t || undefined
}

/** Plain text of an HTML fragment, paragraphs kept apart. */
export function htmlToText(html: string | undefined): string | undefined {
  if (!html) return undefined
  const $ = cheerio.load(`<div id="x">${html}</div>`)
  $("br").replaceWith("\n")
  $("p, li, div, h1, h2, h3, h4, tr").each((_, el) => {
    $(el).append("\n")
  })
  const text = $("#x")
    .text()
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
  return text || undefined
}

/** Cut at a word boundary with an ellipsis, so a short description never ends mid-word. */
export function truncate(text: string | undefined, max: number): string | undefined {
  if (!text || text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(" ")
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** `<loc>` entries of a sitemap, telling an index (of sitemaps) from a URL set. */
export function parseSitemap(xml: string): { kind: "index" | "urlset"; urls: string[] } {
  const $ = cheerio.load(xml, { xml: true })
  const kind = $("sitemapindex").length > 0 ? "index" : "urlset"
  const urls = $(kind === "index" ? "sitemap > loc" : "url > loc")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean)
  return { kind, urls }
}
