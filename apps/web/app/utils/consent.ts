// Consent to audience measurement (story 9.6), as stored in the `scs_consent`
// cookie. Umami is cookie-free and could arguably be exempt, but Franck chose
// to ask anyway (2026-09-24): nothing is measured until the visitor says yes.

/** Bump when the policy changes in a way that must be asked again. */
export const CONSENT_VERSION = 1

/**
 * How long a choice — yes or no — is remembered. The CNIL caps consent at 13
 * months and recommends asking again after a refusal no sooner than 6: one
 * duration for both keeps the banner from reappearing sooner for either answer.
 */
export const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 182

export type ConsentChoice = "granted" | "denied"

export function serializeConsent(choice: ConsentChoice, now = new Date()): string {
  return `v${CONSENT_VERSION}.${choice}.${now.toISOString().slice(0, 10)}`
}

/**
 * The visitor's standing choice, or null when they have not been asked under
 * the current version of the policy — an old or unreadable cookie asks again.
 */
export function parseConsent(value: string | null | undefined): ConsentChoice | null {
  const match = /^v(\d+)\.(granted|denied)\.\d{4}-\d{2}-\d{2}$/.exec(value ?? "")
  if (!match || Number(match[1]) !== CONSENT_VERSION) return null
  return match[2] as ConsentChoice
}
