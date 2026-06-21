import type { ArtworkOrientation } from "@armurier/shared"

export interface ArtworkListItem {
  id: string
  slug: string
  title: string
  artistName: string | null
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
  legalCategory: string | null
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
  artistName: string | null
  artistBio: string | null
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
