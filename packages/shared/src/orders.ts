import { round2 } from "./pricing.js"

// How an order must be paid, depending on what it contains.
export const PAYMENT_SPLIT = {
  VIREMENT_ONLY: "virement_only", // only regulated firearms (bank transfer)
  CARTE_ONLY: "carte_only", // only accessories / Gun Art (card)
  MIXED: "mixed", // both
} as const

export type PaymentSplitType = (typeof PAYMENT_SPLIT)[keyof typeof PAYMENT_SPLIT]

// Payment statuses that count as a completed purchase (e.g. for VIP eligibility).
export const PAID_PAYMENT_STATUSES: readonly string[] = ["received", "reconciled"]

/**
 * Whether an item must be paid by bank transfer (virement) rather than card.
 *
 * Business rule: regulated firearms in legal categories A/B/C require a bank
 * transfer; category D, unregulated ("none") items and Gun Art are payable by
 * card.
 */
export function requiresVirement(legalCategory: string | null | undefined): boolean {
  return legalCategory === "A" || legalCategory === "B" || legalCategory === "C"
}

/**
 * Crockford base32 alphabet — excludes I, L, O and U so the reference is robust
 * to manual transcription (no 1/I, 0/O confusion). The customer copies the
 * reference into their bank's transfer label and the admin matches on it during
 * reconciliation (Story 6.3), so legibility matters more than density.
 */
export const VIREMENT_REF_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

/**
 * Format a bank-transfer payment reference from raw random bytes.
 *
 * Produces `SCS-XXXX-XXXX` (8 Crockford base32 symbols). Pure and injectable:
 * the caller supplies entropy (≥8 bytes) so this stays trivially testable, and
 * uniqueness is enforced by the DB rather than relied upon here.
 */
export function virementReferenceFromBytes(bytes: Uint8Array): string {
  if (bytes.length < 8) {
    throw new Error("virementReferenceFromBytes needs at least 8 bytes of entropy")
  }
  let out = ""
  for (let i = 0; i < 8; i++) {
    out += VIREMENT_REF_ALPHABET[bytes[i] % 32]
  }
  return `SCS-${out.slice(0, 4)}-${out.slice(4)}`
}

export interface PaymentSplitItem {
  priceHt: number
  vatPct: number
  requiresPaymentVirement: boolean
}

export interface PaymentSplit {
  splitType: PaymentSplitType
  virement: { amountHt: number; vat: number; amountTtc: number }
  carte: { amountHt: number; vat: number; amountTtc: number }
}

/** Split order line amounts into a bank-transfer bucket and a card bucket. */
export function calculateOrderPaymentSplit(items: PaymentSplitItem[]): PaymentSplit {
  let virementHt = 0
  let carteHt = 0
  let virementVat = 0
  let carteVat = 0

  for (const item of items) {
    const itemVat = item.priceHt * (item.vatPct / 100)
    if (item.requiresPaymentVirement) {
      virementHt += item.priceHt
      virementVat += itemVat
    } else {
      carteHt += item.priceHt
      carteVat += itemVat
    }
  }

  virementHt = round2(virementHt)
  carteHt = round2(carteHt)
  virementVat = round2(virementVat)
  carteVat = round2(carteVat)

  let splitType: PaymentSplitType
  if (virementHt > 0 && carteHt === 0) {
    splitType = PAYMENT_SPLIT.VIREMENT_ONLY
  } else if (virementHt === 0 && carteHt > 0) {
    splitType = PAYMENT_SPLIT.CARTE_ONLY
  } else {
    splitType = PAYMENT_SPLIT.MIXED
  }

  return {
    splitType,
    virement: {
      amountHt: virementHt,
      vat: virementVat,
      amountTtc: round2(virementHt + virementVat),
    },
    carte: {
      amountHt: carteHt,
      vat: carteVat,
      amountTtc: round2(carteHt + carteVat),
    },
  }
}
