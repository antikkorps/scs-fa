// Admin catalogue shapes (story 7.5a). Mirrors what the admin API returns —
// these screens are the only way content gets into the catalogue.

export interface AdminArtworkListItem {
  id: string
  slug: string
  sku: string
  title: string
  published: boolean
  featured: boolean
  editionLimit: number
  editionYear: number | null
  featuredImageUrl: string | null
  artistName: string | null
  seriesTitle: string | null
  availableCount: number
  soldCount: number
}

export interface AdminArtworkFormat {
  id: string
  name: string
  widthCm: number
  heightCm: number
  priceFactor: number
}

export interface AdminArtworkPrint {
  id: string
  printNumber: number
  printDesignation: string
  formatId: string
  status: "available" | "in_cart" | "sold" | "reserved" | "cancelled"
  priceHt: number
}

export interface AdminArtworkDetail {
  id: string
  productId: string
  slug: string
  sku: string
  title: string
  description: string | null
  longDescription: string | null
  artistId: string | null
  artistName: string | null
  seriesId: string | null
  seriesTitle: string | null
  seriesOrder: number
  editionLimit: number
  editionYear: number | null
  availableFormats: AdminArtworkFormat[]
  basePriceHt: number
  priceIncrementHt: number
  vatPct: number
  orientation: "portrait" | "landscape" | "square"
  includeCertificate: boolean | null
  featuredImageUrl: string | null
  published: boolean
  featured: boolean
  metaTitle: string | null
  metaDescription: string | null
  prints: AdminArtworkPrint[]
}

export interface AdminProductListItem {
  id: string
  sku: string
  slug: string
  name: string
  priceHt: number
  stockQty: number | null
  published: boolean
  featured: boolean
  featuredImageUrl: string | null
  categorySlug: string
  categoryName: string
  legalCategory: string | null
  variantCount: number
}

export interface AdminProductVariant {
  id?: string
  skuVariant: string
  finition: string | null
  munition: string | null
  couleur: string | null
  priceDeltaHt: number
  stockQty: number | null
}

export interface AdminProductDetail extends Omit<AdminProductListItem, "variantCount"> {
  description: string | null
  longDescription: string | null
  vatPct: number
  trackStock: boolean | null
  metaTitle: string | null
  metaDescription: string | null
  variants: AdminProductVariant[]
  tagSlugs: string[]
}

// --- Armes de collection (API livrée en 11.2, écrans en 7.5a) ---------------

export interface AdminAncientWeaponListItem {
  id: string
  sku: string
  slug: string
  name: string
  priceHt: number
  stockQty: number | null
  published: boolean
  period: string | null
  makerName: string | null
  condition: string | null
  isAuthentic: boolean | null
}

export interface AdminAncientWeaponDetail extends AdminAncientWeaponListItem {
  description: string | null
  longDescription: string | null
  vatPct: number
  featured: boolean
  featuredImageUrl: string | null
  categorySlug: string
  legalCategory: string | null
  periodStartYear: number | null
  periodEndYear: number | null
  provenance: string | null
  makerLocation: string | null
  conditionDescription: string | null
  restorationInfo: string | null
  expertName: string | null
  expertDate: string | null
  isUnique: boolean | null
  tags: Array<{ slug: string; name: string; facet: string }>
}
