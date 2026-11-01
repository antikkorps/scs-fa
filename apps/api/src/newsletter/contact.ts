import { createHash } from "node:crypto"

/**
 * A newsletter contact's stable identity key: it survives the purge of the
 * address itself, so a returning visitor finds their consent history, and an
 * account (story 12.11) finds its own subscriptions by its e-mail.
 */
export function newsletterEmailHash(email: string): string {
  return createHash("sha256").update(email).digest("hex")
}
