// Bloc 1 — a newsletter sign-up never confirmed is not a consent: once its
// confirmation link has expired (72 h, NEWSLETTER_CONFIRM_TOKEN_TTL_HOURS), the
// request and the address behind it go. What was consented to before is kept:
// a confirmed segment stays, and a returning contact who never confirmed goes
// back to the anonymous consent trace an unsubscribe leaves.

import { NEWSLETTER_CONFIRM_TOKEN_TTL_HOURS } from "@armurier/shared"
import { and, eq, inArray, isNotNull, lt, notInArray, sql } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { startDailyPurge } from "../daily-purge.js"
import { db } from "../db/client.js"
import { newsletterContacts, newsletterSubscriptions, newsletterTokens } from "../db/schema.js"

const CONFIRM_TOKEN_TTL_MS = NEWSLETTER_CONFIRM_TOKEN_TTL_HOURS * 60 * 60 * 1000

/** Delete what is past its retention. Idempotent: run it as often as you like. */
export async function purgeUnconfirmedNewsletterRequests(now: Date = new Date()): Promise<{
  pendingRequests: number
  erasedContacts: number
  anonymisedContacts: number
  expiredConfirmLinks: number
}> {
  return db.transaction(async (tx) => {
    const stale = await tx
      .delete(newsletterSubscriptions)
      .where(
        and(
          eq(newsletterSubscriptions.status, "pending"),
          lt(newsletterSubscriptions.requestedAt, new Date(now.getTime() - CONFIRM_TOKEN_TTL_MS)),
        ),
      )
      .returning({ contactId: newsletterSubscriptions.contactId })
    // Only the contacts just touched: one being created by a sign-up in flight
    // has no subscription row yet and must not be mistaken for an empty one.
    const touched = [...new Set(stale.map((row) => row.contactId))]

    let erasedContacts = 0
    let anonymisedContacts = 0
    if (touched.length > 0) {
      const withHistory = tx
        .select({ contactId: newsletterSubscriptions.contactId })
        .from(newsletterSubscriptions)
        .where(inArray(newsletterSubscriptions.contactId, touched))
      // Nothing was ever consented to: no trace to keep. Tokens follow by cascade.
      const erased = await tx
        .delete(newsletterContacts)
        .where(and(inArray(newsletterContacts.id, touched), notInArray(newsletterContacts.id, withHistory)))
        .returning({ id: newsletterContacts.id })
      erasedContacts = erased.length

      const stillWanted = tx
        .select({ contactId: newsletterSubscriptions.contactId })
        .from(newsletterSubscriptions)
        .where(
          and(
            inArray(newsletterSubscriptions.contactId, touched),
            inArray(newsletterSubscriptions.status, ["confirmed", "pending"]),
          ),
        )
      // Only withdrawn segments left: same anonymous trace as a full unsubscribe,
      // dated by the withdrawal it records rather than by this purge.
      const anonymised = await tx
        .update(newsletterContacts)
        .set({
          email: null,
          unsubscribedAt: sql`(select max(${newsletterSubscriptions.unsubscribedAt}) from ${newsletterSubscriptions} where ${newsletterSubscriptions.contactId} = ${newsletterContacts.id})`,
          updatedAt: now,
        })
        .where(
          and(
            inArray(newsletterContacts.id, touched),
            isNotNull(newsletterContacts.email),
            notInArray(newsletterContacts.id, stillWanted),
          ),
        )
        .returning({ id: newsletterContacts.id })
      anonymisedContacts = anonymised.length
      if (anonymised.length > 0) {
        await tx.delete(newsletterTokens).where(
          inArray(
            newsletterTokens.contactId,
            anonymised.map((row) => row.id),
          ),
        )
      }
    }

    const expired = await tx
      .delete(newsletterTokens)
      .where(and(eq(newsletterTokens.purpose, "confirm"), lt(newsletterTokens.expiresAt, now)))
      .returning({ id: newsletterTokens.id })

    return {
      pendingRequests: stale.length,
      erasedContacts,
      anonymisedContacts,
      expiredConfirmLinks: expired.length,
    }
  })
}

/** Purge at startup, then once a day. */
export function startNewsletterPurgeScheduler(app: FastifyInstance): void {
  startDailyPurge(app, "newsletter sign-up", purgeUnconfirmedNewsletterRequests)
}
