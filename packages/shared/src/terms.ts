/**
 * Version of the terms of sale (CGV) in force (story 12.1).
 *
 * The checkout sends back the version the customer was shown and ticked; the
 * API refuses an order whose version is not this one, and stores it on the
 * order with the acceptance time. That is the proof of which text a given
 * order was placed under.
 *
 * ⚠️ Bump it (ISO date of the new text) on ANY change to the wording of
 * `/cgv` — never for a pure layout change. Orders placed under the old text
 * keep their version.
 */
export const CURRENT_TERMS_VERSION = "2026-10-08"
