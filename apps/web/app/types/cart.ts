import type { LegalCategoryCode } from "~/types/product"

export interface CartProductLine {
  id: string
  variantId: string
  productId: string
  name: string
  sku: string
  skuVariant: string
  finition: string | null
  munition: string | null
  couleur: string | null
  qty: number
  stockQty: number | null
  vatPct: number
  unitPriceHt: number
  lineHt: number
  discountPct: number
  discountAmount: number
  lineTtc: number
  categorySlug: string
  legalCategory: LegalCategoryCode | null
  requiresLegalVerification: boolean
}

export interface CartArtworkLine {
  id: string
  printId: string
  artworkId: string
  title: string
  printDesignation: string
  formatId: string
  categorySlug: string
  vatPct: number
  unitPriceHt: number
  lineHt: number
  discountPct: number
  discountAmount: number
  lineTtc: number
}

export interface CartView {
  isVip: boolean
  items: CartProductLine[]
  artworkItems: CartArtworkLine[]
  summary: {
    itemCount: number
    subtotalHt: number
    vipDiscountAmount: number
    vatAmount: number
    totalTtc: number
  }
}
