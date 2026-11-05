import type { AnyLegalDocType, LegalDocType, OrderRequiredDocStatus } from "@armurier/shared"
import type { Pagination } from "./pagination"

// Authenticated user profile (GET/PATCH /auth/me — returned without a `data` envelope).
export interface Profile {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  phone: string | null
  role: string
  organisationId: string | null
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
  /** Recorded on every order since the cart froze it; absent on the oldest ones. */
  vatPct?: number
  /** VIP discount on the whole line, HT. */
  discountHt?: number
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
  docType: AnyLegalDocType
  docNumber: string | null
  mimeType: string
  fileSize: number
  scanStatus: string
  scannedAt: string | null
  verificationStatus: string
  issuedAt: string | null
  expiresAt: string | null
  uploadedAt: string
  /** Its holder may still withdraw it: never once SCS approved it, even since expired. */
  removable: boolean
  // Only present on GET /:id, and only once the antivirus scan is clean.
  downloadUrl?: string | null
}

// Metadata accompanying a document upload (all optional besides docType).
export interface LegalDocumentMeta {
  docType: AnyLegalDocType
  docNumber?: string
  issuedAt?: string
  expiresAt?: string
}

// One required document on an order's legal checklist (GET /orders/:id/legal).
export interface RequiredDoc {
  /** The document sent for the line, or its first alternative. */
  docType: LegalDocType
  /** A line any one of these satisfies (I7: hunting or shooting licence). */
  alternatives?: LegalDocType[]
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
