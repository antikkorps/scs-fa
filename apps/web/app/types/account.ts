import type { LegalDocType, OrderRequiredDocStatus } from "@armurier/shared"

// Authenticated user profile (GET/PATCH /auth/me — returned without a `data` envelope).
export interface Profile {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  phone: string | null
  role: string
  addressStreet: string | null
  addressPostal: string | null
  addressCity: string | null
  addressCountry: string | null
  vipStatus: string
  vipActive: boolean
  vipEligibleSince: string | null
  createdAt: string
}

export interface UpdateProfile {
  firstName?: string
  lastName?: string
  phone?: string | null
  addressStreet?: string | null
  addressPostal?: string | null
  addressCity?: string | null
  addressCountry?: string
}

export interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
  hasMore: boolean
}

export interface Paginated<T> {
  data: T[]
  pagination: Pagination
}

// One row of the customer's order list (GET /orders).
export interface OrderSummary {
  id: string
  createdAt: string
  updatedAt: string
  legalVerificationStatus: string
  paymentStatus: string
  subtotalHt: number
  vatAmount: number
  totalTtc: number
  itemCount: number
}

// A single line of an order (subset of the stored itemsJson we display).
export interface OrderLineItem {
  name: string
  qty: number
  priceHt: number
  sku?: string
  category?: string
  legalCategory?: string | null
}

// Address snapshot frozen onto an order at checkout.
export interface OrderAddressSnapshot {
  firstName: string
  lastName: string
  line1: string
  line2: string | null
  postal: string
  city: string
  country: string
  phone: string | null
}

// A legal document uploaded by the user (GET /legal-documents, POST, GET /:id).
export interface LegalDocument {
  id: string
  docType: LegalDocType
  docNumber: string | null
  mimeType: string
  fileSize: number
  scanStatus: string
  scannedAt: string | null
  verificationStatus: string
  issuedAt: string | null
  expiresAt: string | null
  uploadedAt: string
  // Only present on GET /:id, and only once the antivirus scan is clean.
  downloadUrl?: string | null
}

// Metadata accompanying a document upload (all optional besides docType).
export interface LegalDocumentMeta {
  docType: LegalDocType
  docNumber?: string
  issuedAt?: string
  expiresAt?: string
}

// One required document on an order's legal checklist (GET /orders/:id/legal).
export interface RequiredDoc {
  docType: LegalDocType
  status: OrderRequiredDocStatus
  documentId?: string
  uploadedAt?: string | null
  rejectionReason?: string | null
}

export interface OrderLegal {
  orderId: string
  requiresVerification: boolean
  legalVerificationStatus: string
  legalRejectionReason: string | null
  legalVerifiedAt: string | null
  requiredDocs: RequiredDoc[]
}
