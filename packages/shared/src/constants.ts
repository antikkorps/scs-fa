// Catégories légales françaises (Classification préfectorale)
export const LEGAL_CATEGORIES = ["A", "B", "C", "D", "none"] as const
export type LegalCategory = (typeof LEGAL_CATEGORIES)[number]

export const USER_ROLES = ["customer", "vendor", "admin"] as const
export type UserRole = (typeof USER_ROLES)[number]

export const PRODUCT_CATEGORIES = ["firearm", "ammunition", "accessory", "gun_art"] as const
export type ProductCategoryType = (typeof PRODUCT_CATEGORIES)[number]

export const ORDER_LEGAL_STATUS = [
  "pending_docs",
  "docs_under_review",
  "docs_approved",
  "docs_rejected",
  "ready_to_ship",
] as const
export type OrderLegalStatus = (typeof ORDER_LEGAL_STATUS)[number]

export const PAYMENT_STATUS = ["pending", "partial_paid", "paid", "refunded", "failed"] as const
export type PaymentStatus = (typeof PAYMENT_STATUS)[number]

// SLA validation admin docs légaux (heures)
export const LEGAL_DOC_REVIEW_SLA_HOURS = 48

// Gun Art - tirage limité
export const GUN_ART_MAX_PRINTS = 25
