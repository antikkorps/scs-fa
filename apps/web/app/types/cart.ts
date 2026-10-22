import type { ShippingQuote } from "@armurier/shared"
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
  /** A unique piece held for the shopper goes back on sale past this; null otherwise (story 12.9a). */
  heldUntil: string | null
}

export interface CartArtworkLine {
  id: string
  printId: string
  /** The print goes back on sale past this (story 12.9a). */
  heldUntil: string
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
  summary: CartSummary
}

export interface CartSummary {
  itemCount: number
  /** Goods only, before the VIP discount. */
  subtotalHt: number
  vipDiscountAmount: number
  /** Goods and shipping VAT. */
  vatAmount: number
  /** Goods and shipping (story 12.3). */
  totalTtc: number
  shipping: ShippingQuote
}
