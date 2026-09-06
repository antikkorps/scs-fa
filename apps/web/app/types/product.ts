// Shapes for the armurerie catalogue (mirror the API responses).

export type LegalCategoryCode = "A" | "B" | "C" | "D" | "none"

export interface ProductListItem {
  id: string
  sku: string
  slug: string
  name: string
  description: string | null
  priceHt: number
  vatPct: number
  priceTtc: number
  stockQty: number | null
  featured: boolean | null
  requiresLegalVerification: boolean | null
  featuredImageUrl: string | null
  category: { slug: string | null; name: string | null }
  tags: ProductTag[]
  legalCategory: LegalCategoryCode | null
  createdAt: string
}

// The minimal shape ProductCard renders — satisfied by both ProductListItem
// (catalogue) and SearchProductItem (global search), so the card is reused in both.
export interface ProductCardItem {
  slug: string
  name: string
  priceTtc: number
  stockQty: number | null
  requiresLegalVerification: boolean | null
  featuredImageUrl: string | null
  category: { name: string | null }
  legalCategory: LegalCategoryCode | null
}

// Facets group tags in the filter panel. Mirrors TAG_FACETS in @armurier/shared.
export type TagFacet = "etat" | "epoque" | "caracteristique"

export interface ProductTag {
  slug: string
  name: string
  facet: TagFacet
}

export interface TagRef extends ProductTag {
  description: string | null
  productCount: number
}

export interface TagFacetGroup {
  facet: TagFacet
  tags: TagRef[]
}

export interface ProductCategoryRef {
  slug: string
  name: string
  category: string
  displayOrder: number | null
}

export interface LegalCategoryRef {
  category: LegalCategoryCode
  name: string
  description: string | null
  requiresVerification: boolean | null
  minAge: number | null
  requiredDocTypes: string[]
}

export interface ProductVariant {
  id: string
  skuVariant: string
  finition: string | null
  munition: string | null
  couleur: string | null
  stockQty: number | null
  // True while another shopper holds this unique piece in their cart.
  heldByOther?: boolean
  priceDeltaHt: number
  priceHt: number
  priceTtc: number
}

// The historical dossier of a collection weapon (story 11.2). Null on an
// ordinary product.
export interface AncientWeaponDetail {
  period: string | null
  periodStartYear: number | null
  periodEndYear: number | null
  provenance: string | null
  makerName: string | null
  makerLocation: string | null
  condition: string
  conditionDescription: string | null
  restorationInfo: string | null
  isAuthentic: boolean | null
  expertName: string | null
  expertDate: string | null
  historicalInfo: { battles?: string[]; owners?: string[]; events?: string[]; notes?: string } | null
  isUnique: boolean | null
}

export interface AncientWeaponListItem {
  id: string
  slug: string
  name: string
  description: string | null
  priceHt: number
  vatPct: number
  priceTtc: number
  available: boolean
  featured: boolean | null
  featuredImageUrl: string | null
  category: { slug: string | null; name: string | null }
  legalCategory: LegalCategoryCode | null
  tags: ProductTag[]
  period: string | null
  periodStartYear: number | null
  makerName: string | null
  condition: string
  isAuthentic: boolean | null
  createdAt: string
}

export interface AncientWeaponListResponse {
  data: AncientWeaponListItem[]
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean }
}

export interface ProductDetail {
  id: string
  sku: string
  slug: string
  name: string
  description: string | null
  longDescription: string | null
  priceHt: number
  vatPct: number
  priceTtc: number
  stockQty: number | null
  variants: ProductVariant[]
  featured: boolean | null
  requiresLegalVerification: boolean | null
  ageMinRequired: number | null
  hasAccessoryRestrictions: boolean | null
  accessoryRestrictionNotes: string | null
  featuredImageUrl: string | null
  imagesCount: number | null
  seo: { metaTitle: string | null; metaDescription: string | null; keywords: string | null }
  category: { slug: string | null; name: string | null }
  tags: ProductTag[]
  ancientWeapon: AncientWeaponDetail | null
  legalCategory: {
    category: LegalCategoryCode
    name: string
    description: string | null
    requiresVerification: boolean | null
    minAge: number | null
    requiredDocTypes: string[]
  } | null
  createdAt: string
  updatedAt: string
}

export interface ProductListResponse {
  data: ProductListItem[]
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean }
}
