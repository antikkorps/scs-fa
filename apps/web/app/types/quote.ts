import type { LegalCategory, OrganisationStatus, OrganisationType, QuoteRequestStatus } from "@armurier/shared"

// Story 12.8c — the pro catalogue and quote requests, as the API returns them.
// A pro never receives a public price: only their net price, when SCS opens it.

export interface NetPrices {
  netPriceHt: number | null
  netPriceTtc: number | null
}

export interface ProProductCard extends NetPrices {
  id: string
  sku: string
  slug: string
  name: string
  description: string | null
  featuredImageUrl: string | null
  category: { slug: string; name: string }
  legalCategory: LegalCategory | null
  audience: "public" | "pro"
  stockQty: number | null
}

export interface ProProductVariant extends NetPrices {
  id: string
  skuVariant: string
  finition: string | null
  munition: string | null
  couleur: string | null
  stockQty: number | null
}

export interface ProProductDetail extends Omit<ProProductCard, "legalCategory"> {
  longDescription: string | null
  variants: ProProductVariant[]
  legalCategory: { category: LegalCategory; name: string; requiresVerification: boolean } | null
}

export interface QuoteBasketLine extends NetPrices {
  id: string
  qty: number
  /** False once the product left the pro catalogue: the request would be refused. */
  available: boolean
  variant: { id: string; skuVariant: string; label: string | null }
  product: {
    id: string
    slug: string
    name: string
    sku: string
    featuredImageUrl: string | null
    legalCategory: LegalCategory | null
  }
}

export interface QuoteBasket {
  items: QuoteBasketLine[]
}

export interface QuoteRequestSummary {
  id: string
  number: string
  status: QuoteRequestStatus
  message: string | null
  validUntil: string | null
  createdAt: string
  updatedAt: string
  lineCount: number
}

export interface QuoteRequestLine {
  id: string
  position: number
  productId: string | null
  productSlug: string | null
  productName: string
  productSku: string
  variantSku: string | null
  variantLabel: string | null
  legalCategory: LegalCategory | null
  qty: number
}

/** The quote as the pro sees it, once Henrri has issued it (story 12.8d). */
export interface MemberQuote {
  number: string
  issuedAt: string | null
  validUntil: string | null
  items: Array<{ id: string; qty: number; unitPriceHt: number; lineHt: number }>
  shippingTtc: number
  totals: QuoteTotals
}

export interface QuoteRequestDetail extends Omit<QuoteRequestSummary, "lineCount"> {
  items: QuoteRequestLine[]
  quote: MemberQuote | null
}

export interface AdminQuoteRequestRow extends QuoteRequestSummary {
  organisation: { id: string; legalName: string; type: OrganisationType }
  requester: { id: string; email: string; firstName: string | null; lastName: string | null }
}

export interface AdminQuoteRequestLine extends QuoteRequestLine {
  publicPriceHt: number
  vatPct: number
  quotedPriceHt: number | null
  lineDiscountPct: number | null
}

export interface QuoteTotals {
  totalHt: number
  vatAmount: number
  totalTtc: number
}

export interface BillingAddress {
  line1: string | null
  line2: string | null
  postal: string | null
  city: string | null
  country: string
}

/** Story 12.8d — the Henrri quote last queued for the request. */
export interface HenrriQuoteState {
  status: "pending" | "draft" | "finalized" | "blocked"
  number: string | null
  lastError: string | null
  finalizedAt: string | null
}

export interface AdminQuoteRequestDetail extends Omit<QuoteRequestDetail, "items" | "quote"> {
  organisation: {
    id: string
    legalName: string
    siret: string
    type: OrganisationType
    status: OrganisationStatus
    discountPct: number
    net30Allowed: boolean
    showPrices: boolean
    billingAddress: BillingAddress
    billingAddressComplete: boolean
  }
  requester: AdminQuoteRequestRow["requester"]
  items: AdminQuoteRequestLine[]
  sentAt: string | null
  shippingTtc: number
  /** Null while a line is unpriced. */
  totals: QuoteTotals | null
  /** Frozen when the quote is sent. */
  totalTtc: number | null
  /** A line of category A, B or C: the organisation's documents must be judged before acceptance. */
  requiresDocuments: boolean
  documentsSufficient: { at: string; by: string } | null
  henrri: HenrriQuoteState | null
  /** A Henrri quote is on its way: the quote is locked. */
  sending: boolean
}

/** What SCS changes on a quote (adminQuoteUpdateSchema). */
export interface AdminQuoteChanges {
  items?: Array<{ id: string; unitPriceHt?: number; discountPct?: number }>
  shippingTtc?: number
  validUntil?: string
  documentsSufficient?: boolean
}
