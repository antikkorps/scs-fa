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

// Standardized rejection reasons for legal documents (admin review).
// "other" requires a free-text note explaining the decision.
export const LEGAL_DOC_REJECTION_REASONS = [
  "document_expired",
  "document_illegible",
  "wrong_document_type",
  "information_mismatch",
  "document_incomplete",
  "underage",
  "suspected_fraud",
  "other",
] as const
export type LegalDocRejectionReason = (typeof LEGAL_DOC_REJECTION_REASONS)[number]

// Verification lifecycle (matches the `doc_verification_status` DB enum)
export const LEGAL_DOC_VERIFICATION_STATUS = ["pending", "approved", "rejected", "expired"] as const
export type LegalDocVerificationStatus = (typeof LEGAL_DOC_VERIFICATION_STATUS)[number]

// Customer-facing state of a required document on an order's legal checklist
export const ORDER_REQUIRED_DOC_STATUS = [
  "missing", // nothing uploaded for this doc type
  "pending_scan", // uploaded, antivirus scan in progress
  "infected", // scan flagged the file — re-upload needed
  "pending_review", // clean, awaiting admin review
  "approved",
  "rejected", // re-upload allowed (clarification D1)
] as const
export type OrderRequiredDocStatus = (typeof ORDER_REQUIRED_DOC_STATUS)[number]

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
