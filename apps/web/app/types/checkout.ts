export type AddressType = "shipping" | "billing" | "both"

export interface Address {
  id: string
  label: string | null
  type: AddressType
  firstName: string
  lastName: string
  line1: string
  line2: string | null
  postal: string
  city: string
  country: string
  phone: string | null
  isDefault: boolean
}

export interface NewAddress {
  label?: string
  type?: AddressType
  firstName: string
  lastName: string
  line1: string
  line2?: string
  postal: string
  city: string
  country?: string
  phone?: string
  isDefault?: boolean
}

export type SplitType = "virement_only" | "carte_only" | "mixed"

export interface PaymentSplit {
  splitType: SplitType
  virement: { amountHt: number; vat: number; amountTtc: number }
  carte: { amountHt: number; vat: number; amountTtc: number }
}

export interface CreatedOrder {
  id: string
  paymentSplit: PaymentSplit
}

/** Story 11.9 — a parcel as the customer sees it: where it is, never the admin's notes. */
export interface CustomerShipment {
  position: number
  status: string
  carrier: string
  carrierLabel: string
  trackingNumber: string | null
  trackingUrl: string | null
  shippedAt: string | null
  deliveredAt: string | null
  items: Array<{ label: string; qty: number; part: number; parts: number }>
}

export interface OrderDetail {
  id: string
  createdAt: string
  updatedAt: string
  legalVerificationStatus: string
  paymentStatus: string
  subtotalHt: number
  vatAmount: number
  totalTtc: number
  vipDiscountAmount: number
  vipDiscountAppliedPct: number
  items: unknown
  shippingAddress: unknown
  billingAddress: unknown
  shippingStatus: string
  shipments: CustomerShipment[]
  payment: {
    carte: { status: string; amountTtc: number } | null
    virement: {
      status: string
      amountTtc: number
      reference: string
      iban: string
      bic: string | null
      bankName: string | null
      accountHolder: string | null
    } | null
  }
}

export interface VirementInstructions {
  reference: string
  amountTtc: string
  currency: string
  iban: string
  bic: string | null
  bankName: string | null
  accountHolder: string | null
  paymentStatus: string
}
