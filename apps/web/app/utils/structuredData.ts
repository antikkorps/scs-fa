// Builders for the commercial structured data (story 9.6). Pure functions, so
// what search engines receive is unit-tested rather than eyeballed in a page.
//
// Two defects motivated pulling these out of the pages: `artworkImage()` became
// `{ src, fallback }` in story 10.7 and the pages kept passing it as `image` —
// an object holding a `data:` placeholder, which no crawler can use — and the
// blog passed a relative path where schema.org wants an absolute URL.

import type { AvailabilityState } from "./availability"
import { availabilitySchemaUrl } from "./availability"

const CONDITION = {
  new: "https://schema.org/NewCondition",
  used: "https://schema.org/UsedCondition",
} as const

/** The Organization node declared sitewide in app.vue. */
export function organizationRef(siteUrl: string) {
  return { "@type": "Organization", "@id": `${siteUrl}/#organization`, name: "SCS Firearm" }
}

export interface ProductLdInput {
  siteUrl: string
  pageUrl: string
  name: string
  description: string
  sku: string
  /** Absolute image URL, or undefined — never a placeholder. */
  image: string | undefined
  categoryName: string | null
  legalCategory: string | null
  state: AvailabilityState
  /** Price of each purchasable variant, TTC; the product price when it has none. */
  pricesTtc: [number, ...number[]]
  /** A collection weapon, or a product tagged second-hand. */
  used: boolean
  makerName: string | null
}

/**
 * `Product` with its offer. Several variants at different prices make an
 * `AggregateOffer` (low/high price) rather than a single price that would be
 * wrong for all but one of them.
 */
export function productJsonLd(p: ProductLdInput) {
  const prices = p.pricesTtc
  const low = Math.min(...prices)
  const high = Math.max(...prices)
  const common = {
    priceCurrency: "EUR",
    availability: availabilitySchemaUrl(p.state),
    itemCondition: p.used ? CONDITION.used : CONDITION.new,
    url: p.pageUrl,
    seller: organizationRef(p.siteUrl),
  }
  const offers =
    low === high
      ? { "@type": "Offer", price: low, ...common }
      : { "@type": "AggregateOffer", lowPrice: low, highPrice: high, offerCount: prices.length, ...common }

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${p.pageUrl}#product`,
    name: p.name,
    description: p.description,
    sku: p.sku,
    url: p.pageUrl,
    ...(p.image && { image: p.image }),
    ...(p.categoryName && { category: p.categoryName }),
    ...(p.makerName && { manufacturer: { "@type": "Organization", name: p.makerName } }),
    ...(p.legalCategory && {
      additionalProperty: {
        "@type": "PropertyValue",
        name: "Catégorie légale",
        value: p.legalCategory === "none" ? "Vente libre" : p.legalCategory,
      },
    }),
    offers,
  }
}

export interface ArtworkLdInput {
  siteUrl: string
  pageUrl: string
  title: string
  description: string
  image: string | undefined
  artist: { name: string | null; slug: string } | null
  series: { title: string | null; slug: string } | null
  /** Lowest price of an available print, TTC, or null when none is left. */
  priceFromTtc: number | null
  availablePrints: number
}

/**
 * An artwork on sale is both a work of art and a product: typed `VisualArtwork`
 * AND `Product`, so it can earn a product snippet (price, availability) while
 * keeping its creator and series. A closed edition has no price left to show,
 * and a `Product` without an offer is an error for Google — it stays a
 * `VisualArtwork` alone.
 */
export function artworkJsonLd(a: ArtworkLdInput) {
  const onSale = a.priceFromTtc !== null && a.availablePrints > 0
  return {
    "@context": "https://schema.org",
    "@type": onSale ? ["VisualArtwork", "Product"] : "VisualArtwork",
    "@id": `${a.pageUrl}#artwork`,
    name: a.title,
    description: a.description,
    url: a.pageUrl,
    ...(a.image && { image: a.image }),
    artform: "Photographie",
    artMedium: "Tirage pigmentaire",
    ...(a.artist?.name && {
      creator: { "@type": "Person", name: a.artist.name, url: `${a.siteUrl}/collection/artiste/${a.artist.slug}` },
    }),
    // The series is the editorial unit: saying which one this print belongs to
    // is what lets a search engine read the collection as a body of work.
    ...(a.series?.title && {
      isPartOf: {
        "@type": "CreativeWorkSeries",
        name: a.series.title,
        url: `${a.siteUrl}/collection/serie/${a.series.slug}`,
      },
    }),
    ...(onSale && {
      offers: {
        "@type": "AggregateOffer",
        lowPrice: a.priceFromTtc,
        offerCount: a.availablePrints,
        priceCurrency: "EUR",
        availability: availabilitySchemaUrl("available"),
        itemCondition: CONDITION.new,
        url: a.pageUrl,
        seller: organizationRef(a.siteUrl),
      },
    }),
  }
}

/**
 * `ItemList` of a listing page. `position` continues across pages of results,
 * so page 2 starts where page 1 stopped.
 */
export function itemListJsonLd(name: string, urls: { url: string; name: string }[], offset = 0) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    numberOfItems: urls.length,
    itemListElement: urls.map((u, i) => ({ "@type": "ListItem", position: offset + i + 1, url: u.url, name: u.name })),
  }
}
