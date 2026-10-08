// Agora-Tec and Cor Caroli run the same custom PHP platform (agency "Doing"),
// so one adapter serves both.
//
// - No sitemap and no robots.txt. Discovery goes through the category menu:
//   each `/les-articles.htm-reset-marque=…-collection=…` link stores a filter
//   IN THE PHP SESSION, then `/les-articles.htm/liste_article/page/N` returns
//   24 products of that filter. Hence a cookie jar, and no disk cache for
//   those session-dependent pages.
// - Product pages carry no structured data and no category: the category is
//   the "Brand > Collection" of the menu entry the product was found under.
// - `#caracteristiques` opens with a stray `<![CDATA[`, which swallows the
//   `<h2>` that follows: select the list and paragraphs directly.
// - Pro area: the header form signs a reseller in (login code, not e-mail);
//   product pages then show "Votre prix". The header always carries the
//   sign-in form, hidden once signed in — the "Déconnexion" button is the
//   reliable marker. Its link is never followed (discovery only reads the
//   menu and listing fragments).

import { CATALOG_SUPPLIERS, type CollectedProduct, parseBankAmount } from "@armurier/shared"
import * as cheerio from "cheerio"
import { type CollectScope, inScope, type ProLogin, type SupplierAdapter } from "../adapter.js"
import { absoluteUrl, cleanText, fixC1, unique } from "../extract.js"
import type { PoliteClient } from "../http.js"

interface Collection {
  label: string
  url: string
}

/** Menu entries: "Brand > Collection" and their filter URL. */
export function parseCollections(html: string, origin: string): Collection[] {
  const $ = cheerio.load(html)
  const seen = new Set<string>()
  const out: Collection[] = []
  $('a[href^="/les-articles.htm-reset-"]').each((_, el) => {
    const url = absoluteUrl($(el).attr("href"), origin)
    if (!url || seen.has(url)) return
    seen.add(url)
    const params = decodeURIComponent(url.split("/les-articles.htm-reset-")[1] ?? "").replace(/\+/g, " ")
    const brand = params.match(/marque=([^-]+?)(?:-collection=|-type=|$)/)?.[1]
    const collection = params.match(/(?:collection|type)=(.+)$/)?.[1] ?? cleanText($(el).text())
    out.push({ label: [brand, collection].filter(Boolean).join(" > "), url })
  })
  return out
}

/** Number of listing pages announced by the listing shell's script. */
export function parsePageCount(html: string): number {
  return Number(html.match(/num_page_courante < (\d+)/)?.[1] ?? 0)
}

export function parseListingFragment(html: string, origin: string): string[] {
  const $ = cheerio.load(html)
  return $('li.post h2 > a[href^="/article.php-"]')
    .map((_, el) => absoluteUrl($(el).attr("href"), origin))
    .get()
    .filter((u): u is string => Boolean(u))
}

const text = ($: cheerio.CheerioAPI, selector: string) => {
  const t = cleanText($(selector).first().text())
  return t ? fixC1(t) : undefined
}

export function parseDoingProduct(
  html: string,
  url: string,
  category: string | undefined,
): Omit<CollectedProduct, "supplier"> | null {
  const $ = cheerio.load(html)
  const ref = text($, "#descriptif > span")?.replace(/^R[ée]f[ée]rence\s*:\s*/i, "")
  if (!ref) return null

  // Breadcrumb's last entry is "REF - Name": the cleanest name on the page.
  const crumb = text($, '#ariane [itemprop="title"]:last')
  const heading = text($, "#nom_produit h2")
  const brand = cleanText($("#logo_marque img").attr("alt"))
  const name =
    crumb?.replace(new RegExp(`^${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*-\\s*`), "") ??
    (brand ? heading?.replace(new RegExp(`\\s*-\\s*${brand}$`), "") : heading)
  if (!name) return null

  const specs: Record<string, string> = {}
  $("#caracteristiques ul li").each((_, li) => {
    const key = cleanText($(li).find("b").first().text())
    const value = cleanText(
      $(li)
        .text()
        .replace($(li).find("b").first().text(), "")
        .replace(/^\s*:\s*/, ""),
    )
    // "/" is the platform's placeholder for an empty value.
    if (key && value && !/^[/\-–]$/.test(value)) specs[fixC1(key)] = fixC1(value)
  })

  const paragraphs = $("#caracteristiques > p")
    .map((_, p) => $.html(p))
    .get()
    .filter((p) => cleanText(cheerio.load(p).text())?.replace(/^\/$/, ""))
  const longDescription = paragraphs.length > 0 ? fixC1(paragraphs.join("")) : undefined

  const imageUrls = unique(
    $("#slider_une_marque li a.zoom")
      .map((_, a) => absoluteUrl($(a).attr("href"), url))
      .get()
      .filter((u): u is string => Boolean(u)),
  )

  return {
    supplierSku: ref,
    name,
    brand,
    description: text($, "#description .description h3"),
    longDescription,
    specs,
    imageUrls,
    sourceCategory: category ?? brand,
    purchasePrice: parsePurchasePrice(html),
    sourceUrl: url,
  }
}

/** The platform's header shows a "Déconnexion" button to a signed-in reseller. */
export function isSignedIn(html: string, url = ""): boolean {
  // Listing fragments carry no header at all: they cannot tell.
  return (
    url.includes("/liste_article/") ||
    html.includes('id="bandeau_deconnexion"') ||
    html.includes("id='bandeau_deconnexion'")
  )
}

/**
 * Our price, as the pro area prints it under "Votre prix" — only on a page
 * served signed in. The page does not say "HT", but the terms of sale do
 * (`/conditions-generales-de-vente.htm`: « Nos prix s'entendent nets hors
 * taxes départ stock »).
 */
export function parsePurchasePrice(html: string): number | undefined {
  if (!isSignedIn(html)) return undefined
  const $ = cheerio.load(html)
  const block = $("#descriptif .le_prix").first()
  if (!/votre prix/i.test(block.text())) return undefined
  const amount = parseBankAmount(block.find(".normal").first().text())
  return Number.isFinite(amount) && amount > 0 ? amount : undefined
}

function proLoginFor(origin: string, envPrefix: string): ProLogin {
  return {
    envPrefix,
    async signIn(client, { login, password }) {
      // The header form posts to the page it sits on; a refusal redirects to
      // the account page with an error code instead of signing in.
      const landing = await client.postForm(`${origin}/`, {
        szModeAuth_PM: "connexion",
        szLoginAuth_PM: login,
        szPasswordAuth_PM: password,
      })
      if (!isSignedIn(landing)) {
        throw new Error(`${origin} refused the sign-in (check ${envPrefix}_LOGIN / ${envPrefix}_PASSWORD); not retried`)
      }
    },
    isSignedIn,
  }
}

export function doingAdapter(config: {
  id: string
  supplier: string
  origin: string
  /** `.env` prefix of the pro-area login, when the client has one. */
  envPrefix?: string
}): SupplierAdapter {
  // Filled while discovering, read while parsing: the product page itself
  // does not say which category it belongs to.
  const categoryOf = new Map<string, string>()

  const { envPrefix, ...identity } = config
  return {
    ...identity,
    ...(envPrefix ? { proLogin: proLoginFor(config.origin, envPrefix) } : {}),
    async *discover(client: PoliteClient, scope: CollectScope) {
      const collections = parseCollections(await client.get(`${config.origin}/`, { cache: false }), config.origin)
      for (const collection of collections) {
        if (!inScope(scope, collection.label)) continue
        const pages = parsePageCount(await client.get(collection.url, { cache: false }))
        for (let page = 0; page < pages; page++) {
          const fragment = await client.get(`${config.origin}/les-articles.htm/liste_article/page/${page}`, {
            cache: false,
          })
          const urls = parseListingFragment(fragment, config.origin)
          if (urls.length === 0) break
          for (const url of urls) {
            if (!categoryOf.has(url)) categoryOf.set(url, collection.label)
            yield url
          }
        }
      }
    },
    parse(html, url) {
      const product = parseDoingProduct(html, url, categoryOf.get(url))
      return product ? { ...product, supplier: config.supplier } : null
    },
  }
}

export const agoraTec = doingAdapter({
  id: "agora-tec",
  supplier: CATALOG_SUPPLIERS.agoraTec,
  origin: "https://www.agora-tec.fr",
  envPrefix: "AGORATEC",
})
export const corCaroli = doingAdapter({
  id: "cor-caroli",
  supplier: CATALOG_SUPPLIERS.corCaroli,
  origin: "https://www.cor-caroli.fr",
  envPrefix: "CORCAROLI",
})
