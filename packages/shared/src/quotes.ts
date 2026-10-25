// Quotes (story 12.8d): SCS prices a pro's request line by line, from the
// public price less a discount, adds the delivery, and sends it through Henrri.
// The totals are computed by VAT rate, as Henrri computes them, so the quote
// the pro accepts is the order and the invoice to the cent.
import { computeVatTotals, round2, type VatTotals } from "./pricing.js"
import type { ShippingPortion } from "./shipping-costs.js"
import { isoDateSchema } from "./validation.js"
import { z } from "./zod.js"

/** How long a quote holds when SCS does not say otherwise. */
export const DEFAULT_QUOTE_VALIDITY_DAYS = 30

/** The unit price HT a discount on the public price gives. */
export function quotedUnitPriceHt(publicPriceHt: number, discountPct: number): number {
  return round2(publicPriceHt * (1 - discountPct / 100))
}

/** The discount a typed unit price stands for, or null when the public price is zero. */
export function discountPctOf(publicPriceHt: number, unitPriceHt: number): number | null {
  if (publicPriceHt <= 0) return null
  return round2((1 - unitPriceHt / publicPriceHt) * 100)
}

export interface QuotedLine {
  qty: number
  unitPriceHt: number
  vatPct: number
}

/** The quote's totals: each line rounded to the cent, then VAT by rate over lines and delivery. */
export function quoteTotals(lines: readonly QuotedLine[], shipping: readonly ShippingPortion[]): VatTotals {
  return computeVatTotals([
    ...lines.map((line) => ({ priceHt: round2(line.unitPriceHt * line.qty), vatPct: line.vatPct })),
    ...shipping,
  ])
}

const centsSchema = z.number().nonnegative().multipleOf(0.01)

const quoteLineUpdateSchema = z
  .object({
    id: z.string().uuid(),
    unitPriceHt: centsSchema.optional(),
    discountPct: z.number().min(0).max(100).multipleOf(0.01).optional(),
  })
  .strict()
  .refine((line) => (line.unitPriceHt === undefined) !== (line.discountPct === undefined), {
    message: "Give either unitPriceHt or discountPct",
  })

/** What SCS changes on a quote before sending it. */
export const adminQuoteUpdateSchema = z
  .object({
    items: z.array(quoteLineUpdateSchema).min(1).optional(),
    shippingTtc: centsSchema.optional(),
    validUntil: isoDateSchema.optional(),
    documentsSufficient: z.boolean().optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: "At least one field must be provided" })

export type AdminQuoteUpdateInput = z.infer<typeof adminQuoteUpdateSchema>

/** Where an organisation is billed: Henrri wants a structured address on every quote and invoice. */
export const organisationBillingAddressSchema = z
  .object({
    line1: z.string().trim().min(1).max(255),
    line2: z
      .string()
      .trim()
      .max(255)
      .nullish()
      .transform((value) => value || null),
    postal: z.string().trim().min(1).max(10),
    city: z.string().trim().min(1).max(100),
    country: z.string().trim().length(2).toUpperCase().default("FR"),
  })
  .strict()

export type OrganisationBillingAddress = z.infer<typeof organisationBillingAddressSchema>
