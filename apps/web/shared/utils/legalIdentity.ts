/**
 * Who SCS Firearm is, legally (story 12.1) — the facts the legal notice, the
 * CGV and the privacy policy all state. Written once here so the three pages
 * can never disagree.
 *
 * `null` = not supplied yet by the client: `<LegalFact>` shows it as a
 * highlighted placeholder, and a test refuses to mark any of those pages
 * `reviewed` (editorialPages.ts) while a fact is still missing.
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

export const LEGAL_IDENTITY: LegalIdentity = {
  companyName: null,
  legalForm: null,
  shareCapital: null,
  registration: null,
  siret: null,
  vatNumber: null,
  address: null,
  email: null,
  privacyEmail: null,
  phone: null,
  publicationDirector: null,
  firearmsTradeAuthorisation: null,
  mediatorName: null,
  mediatorUrl: null,
}

/** The facts still to be supplied — empty once the client has given them all. */
export function missingLegalFacts(identity: LegalIdentity = LEGAL_IDENTITY): (keyof LegalIdentity)[] {
  return (Object.keys(identity) as (keyof LegalIdentity)[]).filter((k) => !identity[k])
}

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
