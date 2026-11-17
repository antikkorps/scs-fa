import { and, eq, gt, isNull } from "drizzle-orm"
import { type DbExecutor, db } from "../db/client.js"
import { newsletterTokens } from "../db/schema.js"

/**
 * How long a pending address waits before it can be sent another confirmation
 * link. Without it, anyone can make us mail a stranger over and over (each
 * request looks legitimate on its own) and the sending reputation pays for it.
 * While it runs, a new request changes nothing at all: the pending link would
 * otherwise confirm a universe its recipient was never told about.
 */
export const CONFIRMATION_RESEND_COOLDOWN_MS = 15 * 60 * 1000

/** Whether this contact was sent a confirmation link it has not used, within the cooldown. */
export async function confirmationSentRecently(
  contactId: string,
  now: Date,
  executor: DbExecutor = db,
): Promise<boolean> {
  const [recent] = await executor
    .select({ id: newsletterTokens.id })
    .from(newsletterTokens)
    .where(
      and(
        eq(newsletterTokens.contactId, contactId),
        eq(newsletterTokens.purpose, "confirm"),
        isNull(newsletterTokens.usedAt),
        gt(newsletterTokens.createdAt, new Date(now.getTime() - CONFIRMATION_RESEND_COOLDOWN_MS)),
      ),
    )
    .limit(1)
  return Boolean(recent)
}
