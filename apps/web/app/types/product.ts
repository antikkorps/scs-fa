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
  priceDeltaHt: number
  priceHt: number
  priceTtc: number
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
