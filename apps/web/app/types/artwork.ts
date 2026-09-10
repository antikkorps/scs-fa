import type { ArtworkOrientation } from "@armurier/shared"

/** A theme groups series (a film, a universe of reference) — story 11.6. */
export interface ArtworkThemeRef {
  slug: string
  name: string | null
}

export interface ArtworkSeriesRef {
  slug: string
  title: string | null
}

export interface ArtworkListItem {
  id: string
  slug: string
  title: string
  artistName: string | null
  artistSlug: string | null
  series: ArtworkSeriesRef | null
  description: string | null
  featuredImageUrl: string | null
  orientation: ArtworkOrientation
  editionLimit: number
  editionYear: number | null
  availableCount: number
  soldCount: number
  priceFromHt: number | null
  priceFromTtc: number | null
}

// Story 9.1 — a firearm catalogue hit from GET /api/search. The public storefront
// (Phase 10) will render these; for now the search page surfaces artworks only.
export interface SearchProductItem {
  id: string
  sku: string
  slug: string
  name: string
  description: string | null
  priceHt: number
  vatPct: number
  priceTtc: number
  stockQty: number | null
  requiresLegalVerification: boolean | null
  featuredImageUrl: string | null
  category: { slug: string | null; name: string | null }
  legalCategory: import("./product").LegalCategoryCode | null
}

export interface SearchResponse {
  query: string
  products: SearchProductItem[]
  artworks: ArtworkListItem[]
}

export interface ArtworkFormat {
  id: string
  name: string
  widthCm: number
  heightCm: number
  priceFactor: number
}

export interface ArtworkPrint {
  id: string
  printNumber: number
  printDesignation: string
  formatId: string
  status: "available" | "in_cart" | "sold" | "reserved" | "cancelled"
  priceHt: number
  priceTtc: number
}

export interface ArtworkDetail {
  id: string
  slug: string
  title: string
  description: string | null
  longDescription: string | null
  // Story 11.6: nested, so the page can link to the artist and to the series
  // instead of only printing their labels.
  artist: ArtworkArtistRef | null
  series: ArtworkSeriesDetailRef | null
  featuredImageUrl: string | null
  orientation: ArtworkOrientation
  editionLimit: number
  editionYear: number | null
  availableFormats: ArtworkFormat[] | null
  vatPct: number
  includeCertificate: boolean | null
  prints: ArtworkPrint[]
  availableCount: number
  soldCount: number
  priceFromHt: number | null
  priceFromTtc: number | null
}

// --- Éditorial Gun Art (story 11.6) -----------------------------------------

export interface ArtworkArtistRef {
  slug: string
  name: string | null
  headline: string | null
  bio: string | null
  portraitUrl: string | null
}

export interface ArtworkSeriesDetailRef extends ArtworkSeriesRef {
  intro: string | null
  reference: string | null
  theme: ArtworkThemeRef | null
}

export interface ArtworkSeriesListItem {
  id: string
  slug: string
  title: string
  intro: string | null
  reference: string | null
  coverImageUrl: string | null
  theme: ArtworkThemeRef | null
  artist: { slug: string; name: string | null } | null
  artworkCount: number
}

export interface ArtworkSeriesDetail extends ArtworkSeriesListItem {
  artworks: ArtworkListItem[]
}

export interface ArtworkThemeListItem {
  id: string
  slug: string
  name: string
  description: string | null
  seriesCount: number
}

export interface ArtworkThemeDetail {
  id: string
  slug: string
  name: string
  description: string | null
  series: ArtworkSeriesListItem[]
}

export interface ArtistListItem {
  id: string
  slug: string
  name: string
  headline: string | null
  bio: string | null
  journey: string | null
  portraitUrl: string | null
  metaTitle: string | null
  metaDescription: string | null
}

export interface ArtistDetail extends ArtistListItem {
  /** Both halves or nothing: a URL with no title reads as an untrustworthy bare link. */
  book: { title: string; url: string } | null
  series: Array<Omit<ArtworkSeriesListItem, "artworkCount">>
  artworks: ArtworkListItem[]
}
