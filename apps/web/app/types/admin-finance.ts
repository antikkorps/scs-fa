// Beneficiaries and payouts (story 11.10). Admin-only shapes — no public route
// exposes cost prices, charges, margins or third-party shares.

export interface AdminBeneficiary {
  id: string
  slug: string
  name: string
  kind: "artist" | "advisor"
  defaultSharePct: number
  contactEmail: string | null
  paymentNotes: string | null
  active: boolean
  /** Waiting on the money landing. */
  pendingHt: number
  /** Owed now. */
  dueHt: number
  paidHt: number
}

export interface AdminPayout {
  id: string
  orderId: string
  orderPlacedAt: string | null
  beneficiaryId: string
  beneficiaryName: string
  label: string
  /** Frozen at the sale, along with the basis and the amount. */
  sharePct: number
  baseHt: number
  amountHt: number
  status: "pending" | "due" | "paid" | "cancelled"
  paidAt: string | null
  paidNotes: string | null
}

/** What an article earns once cost, charges and the third-party share are off. */
export interface AdminProfitability {
  priceHt: number
  costPriceHt: number
  chargesHt: number
  payoutHt: number
  marginHt: number
  marginPct: number
  /** True when no purchase price is recorded — the margin is then an upper bound. */
  costUnknown: boolean
  /** Artworks only: which print of the edition the figures describe. */
  basedOnPriceHt?: number
}
