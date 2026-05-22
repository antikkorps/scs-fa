// Cross-cutting types shared between API and web.
// API-specific Drizzle inferred types live in apps/api/src/types.ts

import type { LegalCategory, OrderLegalStatus, PaymentStatus, ProductCategoryType, UserRole } from "./constants.js"

export interface UserPublic {
  id: string
  email: string
  role: UserRole
  isVip: boolean
}

export interface ProductSummary {
  id: string
  sku: string
  name: string
  category: ProductCategoryType
  legalCategory: LegalCategory
  priceHt: number
  available: boolean
}

export interface CartItem {
  variantId?: string
  printId?: string
  qty: number
}

export interface OrderSummary {
  id: string
  reference: string
  legalStatus: OrderLegalStatus
  paymentStatus: PaymentStatus
  totalHt: number
  totalTtc: number
  createdAt: string
}
