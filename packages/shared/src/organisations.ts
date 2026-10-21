// Pro accounts (story 12.8b): gunsmiths, shooting clubs, private security
// firms and administrations, each behind one organisation identified by its
// SIRET and approved by hand in the back-office.
import { paginationSchema, registerSchema, toPatchSchema } from "./validation.js"
import { z } from "./zod.js"

export const ORGANISATION_TYPES = ["armurier", "club", "securite_privee", "administration"] as const
export type OrganisationType = (typeof ORGANISATION_TYPES)[number]

// `pending` until SCS has looked at it; only `approved` may ask for a quote.
export const ORGANISATION_STATUSES = ["pending", "approved", "rejected", "suspended"] as const
export type OrganisationStatus = (typeof ORGANISATION_STATUSES)[number]

const SIRET_LENGTH = 14
// INSEE exception: La Poste has more establishments than the Luhn key leaves
// room for, so theirs are keyed on a digit sum divisible by 5 instead.
const LA_POSTE_SIREN = "356000000"

export function normaliseSiret(input: string): string {
  return input.replace(/[\s.-]/g, "")
}

function digitSum(digits: string): number {
  return [...digits].reduce((total, digit) => total + Number(digit), 0)
}

function hasValidLuhnKey(digits: string): boolean {
  let total = 0
  for (let offsetFromRight = 0; offsetFromRight < digits.length; offsetFromRight++) {
    let digit = Number(digits[digits.length - 1 - offsetFromRight])
    if (offsetFromRight % 2 === 1) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    total += digit
  }
  return total % 10 === 0
}

/** True for a well-formed SIRET (digits only — normalise first). Says nothing of whether it exists. */
export function isValidSiret(siret: string): boolean {
  if (!new RegExp(`^\\d{${SIRET_LENGTH}}$`).test(siret)) return false
  if (hasValidLuhnKey(siret)) return true
  return siret.startsWith(LA_POSTE_SIREN) && digitSum(siret) % 5 === 0
}

// INSEE legal natures starting with 7 are public-law entities (State,
// local authorities, public establishments).
export const PUBLIC_LAW_NATURE_PREFIX = "7"

/** The type to preselect from the registry's legal nature, when it tells. */
export function suggestedOrganisationType(legalNature: string | null): OrganisationType | null {
  return legalNature?.startsWith(PUBLIC_LAW_NATURE_PREFIX) ? "administration" : null
}

export const siretSchema = z
  .string()
  .transform(normaliseSiret)
  .refine(isValidSiret, { message: "Invalid SIRET number" })

const organisationRequestFields = {
  siret: siretSchema,
  legalName: z.string().trim().min(1).max(255),
  organisationType: z.enum(ORGANISATION_TYPES),
}

/** A new pro: the account and its organisation in one form. */
export const proSignupSchema = registerSchema.extend(organisationRequestFields)

/** A customer already registered who asks to become pro. */
export const organisationRequestSchema = z.object(organisationRequestFields)

export type ProSignupInput = z.infer<typeof proSignupSchema>
export type OrganisationRequestInput = z.infer<typeof organisationRequestSchema>

// ---------------------------------------------------------------------------
// Back-office (story 12.8b)

/** The commercial terms SCS sets on an organisation (decision 2026-10-19). */
export const organisationTermsSchema = z
  .object({
    // A rate on the public price excluding VAT, applied to every price shown to the pro.
    discountPct: z.number().min(0).max(100).multipleOf(0.01),
    net30Allowed: z.boolean(),
    showPrices: z.boolean(),
  })
  .strict()

/** Approval may set the terms at once; left out, administrations get the 30-day payment. */
export const approveOrganisationSchema = toPatchSchema(organisationTermsSchema).strict()

export const updateOrganisationTermsSchema = toPatchSchema(organisationTermsSchema)
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: "At least one field must be provided" })

/** A refusal or a suspension: the reason is mailed to the member as written. */
export const organisationReviewReasonSchema = z.object({ reason: z.string().trim().min(3).max(1000) }).strict()

export const adminOrganisationListQuerySchema = paginationSchema.extend({
  status: z.enum(ORGANISATION_STATUSES).optional(),
})

export type OrganisationTermsInput = z.infer<typeof organisationTermsSchema>
export type ApproveOrganisationInput = z.infer<typeof approveOrganisationSchema>
export type UpdateOrganisationTermsInput = z.infer<typeof updateOrganisationTermsSchema>

// ---------------------------------------------------------------------------
// Quote requests (story 12.8c): a pro's basket becomes a request SCS answers
// with a quote (12.8d).

export const QUOTE_REQUEST_STATUSES = [
  "requested",
  "in_review",
  "sent",
  "accepted",
  "declined",
  "expired",
  "converted",
  "cancelled",
] as const
export type QuoteRequestStatus = (typeof QUOTE_REQUEST_STATUSES)[number]

/** What a pro may still cancel: SCS has not started on it. */
export const CANCELLABLE_QUOTE_STATUSES = ["requested"] as const satisfies readonly QuoteRequestStatus[]

export const MAX_QUOTE_LINE_QTY = 9999
export const MAX_QUOTE_LINES = 200
export const MAX_QUOTE_MESSAGE_LENGTH = 2000

const quoteQtySchema = z.number().int().min(1).max(MAX_QUOTE_LINE_QTY)

export const quoteBasketItemSchema = z.object({ variantId: z.string().uuid(), qty: quoteQtySchema.default(1) }).strict()

export const quoteBasketQtySchema = z.object({ qty: quoteQtySchema }).strict()

export const quoteRequestSubmitSchema = z
  .object({ message: z.string().trim().max(MAX_QUOTE_MESSAGE_LENGTH).optional() })
  .strict()

export const adminQuoteRequestListQuerySchema = paginationSchema.extend({
  status: z.enum(QUOTE_REQUEST_STATUSES).optional(),
})

export type QuoteBasketItemInput = z.infer<typeof quoteBasketItemSchema>
export type QuoteRequestSubmitInput = z.infer<typeof quoteRequestSubmitSchema>
