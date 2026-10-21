// Pro accounts (story 12.8b): gunsmiths, shooting clubs, private security
// firms and administrations, each behind one organisation identified by its
// SIRET and approved by hand in the back-office.
import { registerSchema } from "./validation.js"
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
