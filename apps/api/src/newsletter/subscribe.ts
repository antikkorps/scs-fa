// Story 11.4 + abuse guard (2026-11-17) — recording a sign-up request.
// Everything happens in one transaction, under a lock on the address: two
// requests for the same address, from anywhere, are taken one after the other,
// so the resend cooldown cannot be raced into a burst of mails.

import { NEWSLETTER_SEGMENT_LABELS, type NewsletterSegment } from "@armurier/shared"
import { and, eq, inArray, sql } from "drizzle-orm"
import { generateRefreshToken as generateLinkToken, hashRefreshToken as hashLinkToken } from "../auth/tokens.js"
import { type DbExecutor, db } from "../db/client.js"
import { newsletterContacts, newsletterSubscriptions, newsletterTokens } from "../db/schema.js"
import { confirmationSentRecently } from "./abuse.js"
import { newsletterEmailHash } from "./contact.js"

export interface SubscribeRequest {
  email: string
  segments: NewsletterSegment[]
  source: string | null
  ip: string
  userAgent: string | null
  confirmTtlMs: number
}

/** What the confirmation mail needs; its link tokens are already stored. */
export interface ConfirmationMail {
  confirmToken: string
  unsubscribeToken: string
  segmentLabels: string[]
}

export interface RecordedSubscription {
  contactId: string
  /** Null when nothing is left to confirm (every universe already confirmed). */
  mail: ConfirmationMail | null
}

/**
 * Record the request; null when it was held back because the address still has
 * a fresh, unused link — then nothing at all changed.
 */
export function recordSubscription(request: SubscribeRequest, now: Date): Promise<RecordedSubscription | null> {
  const emailHash = newsletterEmailHash(request.email)
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${emailHash}))`)
    const [known] = await tx
      .select({ id: newsletterContacts.id })
      .from(newsletterContacts)
      .where(eq(newsletterContacts.emailHash, emailHash))
    if (known && (await confirmationSentRecently(known.id, now, tx))) return null

    const contactId = await upsertContact(tx, request.email, emailHash, now)
    await upsertPendingSegments(tx, contactId, request, now)
    const pending = await pendingSegments(tx, contactId, request.segments)
    const mail = pending.length > 0 ? await issueLinks(tx, contactId, pending, now, request.confirmTtlMs) : null
    return { contactId, mail }
  })
}

// Re-subscribing after a purge finds the consent proof by its hash and puts the
// address back on it, instead of forking a second contact.
async function upsertContact(tx: DbExecutor, email: string, emailHash: string, now: Date): Promise<string> {
  const [contact] = await tx
    .insert(newsletterContacts)
    .values({ email, emailHash })
    .onConflictDoUpdate({ target: newsletterContacts.emailHash, set: { email, updatedAt: now, unsubscribedAt: null } })
    .returning({ id: newsletterContacts.id })
  if (!contact) throw new Error("newsletter: contact upsert returned no row")
  return contact.id
}

/** A confirmed universe keeps its confirmation and its original proof of consent. */
const keepIfConfirmed = (confirmedValue: unknown, otherwise: unknown) =>
  sql`case when ${newsletterSubscriptions.status} = 'confirmed' then ${confirmedValue} else ${otherwise} end`

async function upsertPendingSegments(tx: DbExecutor, contactId: string, request: SubscribeRequest, now: Date) {
  await tx
    .insert(newsletterSubscriptions)
    .values(
      request.segments.map((segment) => ({
        contactId,
        segment,
        status: "pending" as const,
        requestedAt: now,
        consentSource: request.source,
        consentIp: request.ip,
        consentUserAgent: request.userAgent,
      })),
    )
    .onConflictDoUpdate({
      target: [newsletterSubscriptions.contactId, newsletterSubscriptions.segment],
      // Re-submitting the form must not silently demote a subscriber to pending.
      set: {
        status: keepIfConfirmed(newsletterSubscriptions.status, sql`'pending'::newsletter_subscription_status`),
        requestedAt: keepIfConfirmed(newsletterSubscriptions.requestedAt, now),
        consentSource: keepIfConfirmed(newsletterSubscriptions.consentSource, request.source),
        unsubscribedAt: null,
      },
    })
}

async function pendingSegments(tx: DbExecutor, contactId: string, segments: NewsletterSegment[]) {
  const rows = await tx
    .select({ segment: newsletterSubscriptions.segment })
    .from(newsletterSubscriptions)
    .where(
      and(
        eq(newsletterSubscriptions.contactId, contactId),
        eq(newsletterSubscriptions.status, "pending"),
        inArray(newsletterSubscriptions.segment, segments),
      ),
    )
  return rows.map((row) => row.segment)
}

async function issueLinks(
  tx: DbExecutor,
  contactId: string,
  pending: NewsletterSegment[],
  now: Date,
  confirmTtlMs: number,
): Promise<ConfirmationMail> {
  const confirmToken = generateLinkToken()
  const unsubscribeToken = generateLinkToken()
  await tx.insert(newsletterTokens).values([
    {
      contactId,
      tokenHash: hashLinkToken(confirmToken),
      purpose: "confirm",
      expiresAt: new Date(now.getTime() + confirmTtlMs),
    },
    { contactId, tokenHash: hashLinkToken(unsubscribeToken), purpose: "unsubscribe" },
  ])
  return { confirmToken, unsubscribeToken, segmentLabels: pending.map((segment) => NEWSLETTER_SEGMENT_LABELS[segment]) }
}

/** A mail that could not leave must not hold the address back for the whole cooldown. */
export async function withdrawConfirmLink(confirmToken: string): Promise<void> {
  await db.delete(newsletterTokens).where(eq(newsletterTokens.tokenHash, hashLinkToken(confirmToken)))
}
