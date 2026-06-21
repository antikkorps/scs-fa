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

export interface PaymentCarte {
  id: string
  amountTtc: string
  currency: string | null
  paymentStatus: string
  stripePaymentIntentId: string | null
  last4: string | null
  brand: string | null
}

export interface PaymentVirement {
  id: string
  amountExpectedTtc: string
  amountReceivedTtc: string | null
  currency: string | null
  paymentReference: string | null
  paymentStatus: string
  receivedFromIban: string | null
  reconciliationNotes: string | null
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
    carte: PaymentCarte | null
    virement: PaymentVirement | null
    refunds: RefundRow[]
  }
}

// Story 6.3/6.4 admin payment actions
export interface VirementRow {
  id: string
  orderId: string
  amountExpectedTtc: string
  amountReceivedTtc: string | null
  currency: string | null
  paymentReference: string | null
  paymentStatus: string
  clientReportedIban: string | null
  clientReportedDate: string | null
  clientReportedAmount: string | null
  clientReportedRef: string | null
  clientNotes: string | null
  receivedAt: string | null
  receivedFromIban: string | null
  reconciledAt: string | null
  reconciliationNotes: string | null
  createdAt: string
  user: OrderCustomer
}

export interface BankImportLine {
  label: string
  amount: number
  reference: string | null
  outcome: "reconciled" | "amount_mismatch" | "unknown_reference" | "no_reference" | "not_a_credit"
  orderId?: string
  virementId?: string
  amountExpectedTtc?: string
}

export interface BankImportReport {
  total: number
  reconciled: number
  needsReview: number
  lines: BankImportLine[]
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

export interface MetricsResult {
  period: { from: string; to: string }
  revenue: { grossTtc: number; refundedTtc: number; netTtc: number; paidOrders: number }
  commission: { ratePct: number; amount: number }
  funnel: {
    totalOrders: number
    paidOrders: number
    pendingOrders: number
    failedOrders: number
    refundedOrders: number
    conversionPct: number
  }
  legalSla: {
    reviewed: number
    withinSla: number
    withinSlaPct: number
    avgReviewHours: number | null
    pendingOverdue: number
  }
  timeseries: Array<{ date: string; grossTtc: number }>
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

// Story 9.4 — blog backoffice
export interface AdminBlogListItem {
  id: string
  slug: string
  title: string
  category: string | null
  published: boolean
  featured: boolean
  publishedAt: string | null
  updatedAt: string
  authorName: string | null
}

export interface AdminBlogArticle {
  id: string
  slug: string
  title: string
  excerpt: string | null
  content: string
  category: string | null
  tags: string | null
  featuredImageUrl: string | null
  metaTitle: string | null
  metaDescription: string | null
  published: boolean
  featured: boolean
  publishedAt: string | null
  authorId: string | null
  createdAt: string
  updatedAt: string
}

// Editable fields posted to create/update (mirrors the shared zod schemas).
export interface BlogFormValues {
  slug: string
  title: string
  excerpt: string
  content: string
  category: string
  tags: string
  featuredImageUrl: string
  metaTitle: string
  metaDescription: string
  published: boolean
  featured: boolean
}
