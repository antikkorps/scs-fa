import { z } from "zod"
import { emailSchema, phoneSchema } from "./validation.js"

/**
 * Who SCS Firearms is, legally (story 12.1) — the facts the legal notice, the
 * CGV, the privacy policy and the order confirmation e-mail all state.
 *
 * Since the 2026-11-01 audit (I8) they live in ONE record the admins fill in
 * the back-office (`shop_identity`), with the contact details the /contact page
 * shows — so they can never disagree, and no deployment is needed to change them.
 *
 * `null` = not supplied yet: it renders as a highlighted placeholder
 * (`<LegalFact>` on the site, "[label]" in e-mails), and a legal page stays out
 * of the index while one of its facts is missing.
 */
export interface LegalIdentity {
  /** Raison sociale. */
  companyName: string | null
  /** SAS, SARL, EI… */
  legalForm: string | null
  shareCapital: string | null
  /** "RCS <ville> <numéro>". */
  registration: string | null
  siret: string | null
  vatNumber: string | null
  /** Registered office, one line. */
  address: string | null
  email: string | null
  /** Address for personal-data requests — may be the same as `email`. */
  privacyEmail: string | null
  phone: string | null
  /** Natural person answerable for what the site publishes (LCEN art. 6). */
  publicationDirector: string | null
  /** Prefectoral authorisation to trade in firearms (CSI art. L313-2 et seq.). */
  firearmsTradeAuthorisation: string | null
  /** Consumer mediator the seller has signed up with (Code conso. art. L612-1). */
  mediatorName: string | null
  mediatorUrl: string | null
}

/** Contact details shown on /contact, beside the legal facts (audit 2026-11-01, I8). */
export interface ShopIdentity extends LegalIdentity {
  /** Opening hours, free text ("Du mardi au samedi, 9 h – 18 h"). */
  contactHours: string | null
  /** A line for visitors ("Retrait en boutique sur rendez-vous"). */
  contactNote: string | null
}

/** The legal facts, in the order the admin screen lists them. */
export const LEGAL_FACT_KEYS = [
  "companyName",
  "legalForm",
  "shareCapital",
  "registration",
  "siret",
  "vatNumber",
  "address",
  "email",
  "privacyEmail",
  "phone",
  "publicationDirector",
  "firearmsTradeAuthorisation",
  "mediatorName",
  "mediatorUrl",
] as const satisfies (keyof LegalIdentity)[]

/** Nothing supplied yet: a fresh database, or the API unreachable. */
export const EMPTY_SHOP_IDENTITY: ShopIdentity = {
  ...(Object.fromEntries(LEGAL_FACT_KEYS.map((key) => [key, null])) as Record<keyof LegalIdentity, null>),
  contactHours: null,
  contactNote: null,
}

/** The legal facts still to be supplied — empty once the client has given them all. */
export function missingLegalFacts(identity: LegalIdentity | ShopIdentity): (keyof LegalIdentity)[] {
  return LEGAL_FACT_KEYS.filter((key) => !identity[key])
}

/** Free text: trimmed, and blank means "not supplied yet" (null). */
const text = (max: number) =>
  z
    .union([z.string(), z.null()])
    .transform((value) => value?.trim() || null)
    .pipe(z.string().max(max).nullable())

const optional = (format: z.ZodType<string, string>) =>
  z
    .union([z.string(), z.null()])
    .transform((value) => value?.trim() || null)
    .pipe(format.nullable())

/** The identity record, replaced whole by an admin (PUT): every field present, nothing else. */
export const shopIdentitySchema = z
  .object({
    companyName: text(200),
    legalForm: text(100),
    shareCapital: text(100),
    registration: text(200),
    siret: z
      .union([z.string(), z.null()])
      .transform((value) => value?.replace(/\s+/g, "") || null)
      .pipe(
        z
          .string()
          .regex(/^\d{14}$/, "A SIRET has 14 digits")
          .nullable(),
      ),
    vatNumber: text(50),
    address: text(300),
    email: optional(emailSchema),
    privacyEmail: optional(emailSchema),
    phone: optional(phoneSchema),
    publicationDirector: text(200),
    firearmsTradeAuthorisation: text(300),
    mediatorName: text(200),
    mediatorUrl: optional(
      z
        .string()
        .max(500)
        .regex(/^https?:\/\/\S+$/, "An http(s) address"),
    ),
    contactHours: text(300),
    contactNote: text(500),
  })
  .strict()

/**
 * Hosting provider of the site (LCEN art. 6): known from the infrastructure
 * (docs/DEPLOY.md), not something the client supplies.
 */
export const SITE_HOST = {
  name: "Hetzner Online GmbH",
  address: "Industriestr. 25, 91710 Gunzenhausen, Allemagne",
  phone: "+49 9831 505-0",
  url: "https://www.hetzner.com",
} as const
