// Catégories légales françaises (Classification préfectorale)
export const LEGAL_CATEGORIES = ["A", "B", "C", "D", "none"] as const
export type LegalCategory = (typeof LEGAL_CATEGORIES)[number]

export const USER_ROLES = ["customer", "vendor", "admin"] as const
export type UserRole = (typeof USER_ROLES)[number]

export const ADDRESS_TYPES = ["shipping", "billing", "both"] as const
export type AddressType = (typeof ADDRESS_TYPES)[number]

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

// Legal document types a customer can upload (matches the `doc_type` DB enum)
export const LEGAL_DOC_TYPES = ["cni", "permis_chasse", "autorisation_det", "sia", "expertise"] as const
export type LegalDocType = (typeof LEGAL_DOC_TYPES)[number]

// Antivirus scan lifecycle (matches the `doc_scan_status` DB enum)
export const LEGAL_DOC_SCAN_STATUS = ["pending", "clean", "infected"] as const
export type LegalDocScanStatus = (typeof LEGAL_DOC_SCAN_STATUS)[number]

// Accepted upload formats and size cap for legal documents
export const ALLOWED_LEGAL_DOC_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const
export type AllowedLegalDocMimeType = (typeof ALLOWED_LEGAL_DOC_MIME_TYPES)[number]

export const MAX_LEGAL_DOC_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

// Gun Art - tirage limité
export const GUN_ART_MAX_PRINTS = 25
