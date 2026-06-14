// Shapes consumed by the admin dashboard (mirror the API responses).

export interface AuthUser {
  id: string
  email: string
  firstName: string
  lastName: string
  role: "customer" | "vendor" | "admin"
}

export interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
  hasMore: boolean
}

export interface OrderCustomer {
  id: string
  email: string
  firstname: string | null
  lastname: string | null
}

export interface AdminOrderListItem {
  id: string
  createdAt: string
  updatedAt: string
  legalVerificationStatus: string
  paymentStatus: string
  totalTtc: number
  itemCount: number
  user: OrderCustomer
}

export interface OrderItem {
  variantId?: string
  printId?: string
  qty: number
  priceHt: number
  name: string
  sku: string
  category: string
  legalCategory?: string | null
  requiresPaymentVirement: boolean
}

export interface AddressSnapshot {
  firstName: string
  lastName: string
  line1: string
  line2: string | null
  postal: string
  city: string
  country: string
  phone: string | null
}

export interface RefundRow {
  id: string
  channel: "carte" | "virement"
  amountTtc: string
  status: string
  reason: string | null
  stripeRefundId: string | null
  createdAt: string
}

export interface AdminOrderDetail {
  id: string
  createdAt: string
  updatedAt: string
  legalVerificationStatus: string
  legalRejectionReason: string | null
  paymentStatus: string
  subtotalHt: number
  vatAmount: number
  totalTtc: number
  vipDiscountAmount: number
  items: OrderItem[]
  shippingAddress: AddressSnapshot | null
  billingAddress: AddressSnapshot | null
  user: OrderCustomer
  payment: {
    carte: Record<string, unknown> | null
    virement: Record<string, unknown> | null
    refunds: RefundRow[]
  }
}

export interface OrdersSummary {
  totalOrders: number
  awaitingPayment: number
  paid: number
  refunded: number
  docsToReview: number
  docsRejected: number
  byPaymentStatus: Record<string, number>
  byLegalStatus: Record<string, number>
}

export interface LegalDocQueueItem {
  id: string
  docType: string
  docNumber: string | null
  scanStatus: string
  verificationStatus: string
  verificationDeadline: string | null
  rejectionReason: string | null
  uploadedAt: string
  overdue: boolean
  user: OrderCustomer
}

export interface LegalDocDetail extends LegalDocQueueItem {
  mimeType: string | null
  fileSize: number | null
  issuedAt: string | null
  expiresAt: string | null
  verificationNotes: string | null
  downloadUrl: string
}
