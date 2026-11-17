// The robot traps of the public forms (contact, newsletter): a hidden field
// people never see but scripts fill, and the time the form took to fill. Free,
// invisible to people, no third party — what a captcha would cost them.
import { z } from "./zod.js"

/** Below this, the form was filled by a script, not read and typed by a person. */
export const MIN_FORM_FILL_MS = 3000

/** Spread into a form's schema: the fields every public form's page sends. */
export const botTrapFields = {
  // Hidden from people, filled by robots (the "honeypot").
  website: z.string().max(500).optional(),
  /** Time between the form showing and its sending, measured by the page. */
  filledInMs: z.number().int().nonnegative().max(86_400_000),
}

export interface BotTrapInput {
  website?: string
  filledInMs: number
}

/** A robot gives itself away: the hidden field filled, or no time to read the form. */
export function looksAutomated(input: BotTrapInput): boolean {
  return Boolean(input.website?.trim()) || input.filledInMs < MIN_FORM_FILL_MS
}
