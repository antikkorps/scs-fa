import { createHash } from "node:crypto"
import {
  NEWSLETTER_CONFIRM_TOKEN_TTL_HOURS,
  NEWSLETTER_SEGMENT_LABELS,
  type NewsletterSegment,
  newsletterConfirmSchema,
  newsletterSubscribeSchema,
  newsletterTokenSchema,
  newsletterUnsubscribeSchema,
} from "@armurier/shared"
import { and, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm"
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify"
// Opaque single-use link tokens: same construction as the password-reset ones
// (32 random bytes, stored as a SHA-256 hash), reused rather than re-invented.
import { generateRefreshToken as generateLinkToken, hashRefreshToken as hashLinkToken } from "../auth/tokens.js"
import { db } from "../db/client.js"
import { auditLogs, newsletterContacts, newsletterSubscriptions, newsletterTokens } from "../db/schema.js"
import { sendNewsletterConfirmationEmail } from "../email.js"
import { newsletterProvider } from "./service.js"

const CONFIRM_TOKEN_TTL_MS = NEWSLETTER_CONFIRM_TOKEN_TTL_HOURS * 60 * 60 * 1000

/** Stable identity key that survives the purge of the address itself. */
function hashEmail(email: string): string {
  return createHash("sha256").update(email).digest("hex")
}

function validationError(reply: FastifyReply, issues: { path: PropertyKey[]; message: string }[]) {
  return reply.code(400).send({
    error: "ValidationError",
    issues: issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
  })
}

function invalidToken(reply: FastifyReply) {
  return reply.code(400).send({
    error: "InvalidOrExpiredToken",
    message: "Ce lien est invalide, expiré ou déjà utilisé.",
  })
}

/** Segments the contact is currently subscribed to (confirmed = mailable). */
async function confirmedSegments(contactId: string): Promise<NewsletterSegment[]> {
  const rows = await db
    .select({ segment: newsletterSubscriptions.segment })
    .from(newsletterSubscriptions)
    .where(and(eq(newsletterSubscriptions.contactId, contactId), eq(newsletterSubscriptions.status, "confirmed")))
  return rows.map((r) => r.segment)
}

/**
 * Mirror the local consent state to the sending provider.
 *
 * Best-effort **by design**: our database is the source of truth for consent, so
 * a provider outage must never make a visitor's confirmation fail. The failure is
 * logged and `provider_synced_at` stays null, which is exactly the marker a
 * replay would look for.
 */
async function syncProvider(
  request: FastifyRequest,
  contactId: string,
  email: string,
  segments: NewsletterSegment[],
): Promise<void> {
  try {
    if (segments.length === 0) await newsletterProvider.deleteContact(email)
    else await newsletterProvider.syncContact({ email, segments })

    if (segments.length > 0) {
      await db
        .update(newsletterSubscriptions)
        .set({ providerSyncedAt: new Date() })
        .where(
          and(eq(newsletterSubscriptions.contactId, contactId), inArray(newsletterSubscriptions.segment, segments)),
        )
    }
  } catch (err) {
    request.log.error({ err }, "newsletter: provider sync failed (consent is recorded locally)")
  }
}

/**
 * Mint a long-lived unsubscribe token. A fresh one per mail rather than a stored
 * secret reused everywhere: tokens are kept hashed, so an existing one cannot be
 * read back. Every one of them stays valid until the address is purged, which is
 * what an unsubscribe link in an old letter needs.
 */
async function issueUnsubscribeToken(contactId: string): Promise<string> {
  const token = generateLinkToken()
  await db.insert(newsletterTokens).values({ contactId, tokenHash: hashLinkToken(token), purpose: "unsubscribe" })
  return token
}

export const newsletterRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /api/newsletter/subscribe — capture an address (double opt-in step 1).
   *
   * Nothing is sent to the provider here and the contact is not mailable yet: the
   * row is `pending` until the confirmation link is followed. The response is
   * deliberately constant, so the endpoint cannot be used to probe whether an
   * address is already subscribed.
   */
  fastify.post(
    "/subscribe",
    { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const parsed = newsletterSubscribeSchema.safeParse(request.body)
      if (!parsed.success) return validationError(reply, parsed.error.issues)

      const email = parsed.data.email.trim().toLowerCase()
      const emailHash = hashEmail(email)
      const now = new Date()

      // Re-subscribing after a purge finds the anonymised trace by its hash and
      // puts the address back on it, instead of forking a second contact.
      const [contact] = await db
        .insert(newsletterContacts)
        .values({ email, emailHash })
        .onConflictDoUpdate({
          target: newsletterContacts.emailHash,
          set: { email, updatedAt: now, unsubscribedAt: null },
        })
        .returning({ id: newsletterContacts.id })
      if (!contact) throw new Error("newsletter: contact upsert returned no row")

      await db
        .insert(newsletterSubscriptions)
        .values(
          parsed.data.segments.map((segment) => ({
            contactId: contact.id,
            segment,
            status: "pending" as const,
            requestedAt: now,
            consentSource: parsed.data.source ?? null,
            consentIp: request.ip,
            consentUserAgent: request.headers["user-agent"] ?? null,
          })),
        )
        .onConflictDoUpdate({
          target: [newsletterSubscriptions.contactId, newsletterSubscriptions.segment],
          // An already-confirmed segment keeps its confirmation (and its original
          // proof of consent): re-submitting the form must not silently demote a
          // subscriber back to pending and stop their mails.
          set: {
            status: sql`case when ${newsletterSubscriptions.status} = 'confirmed' then 'confirmed'::newsletter_subscription_status else 'pending'::newsletter_subscription_status end`,
            requestedAt: sql`case when ${newsletterSubscriptions.status} = 'confirmed' then ${newsletterSubscriptions.requestedAt} else ${now} end`,
            consentSource: sql`case when ${newsletterSubscriptions.status} = 'confirmed' then ${newsletterSubscriptions.consentSource} else ${parsed.data.source ?? null} end`,
            unsubscribedAt: null,
          },
        })

      const pending = await db
        .select({ segment: newsletterSubscriptions.segment })
        .from(newsletterSubscriptions)
        .where(
          and(
            eq(newsletterSubscriptions.contactId, contact.id),
            eq(newsletterSubscriptions.status, "pending"),
            inArray(newsletterSubscriptions.segment, parsed.data.segments),
          ),
        )

      if (pending.length > 0) {
        const confirmToken = generateLinkToken()
        await db.insert(newsletterTokens).values({
          contactId: contact.id,
          tokenHash: hashLinkToken(confirmToken),
          purpose: "confirm",
          expiresAt: new Date(now.getTime() + CONFIRM_TOKEN_TTL_MS),
        })
        const unsubscribeToken = await issueUnsubscribeToken(contact.id)

        await sendNewsletterConfirmationEmail(email, {
          confirmToken,
          unsubscribeToken,
          segmentLabels: pending.map((p) => NEWSLETTER_SEGMENT_LABELS[p.segment]),
        }).catch((err) => {
          request.log.error({ err }, "newsletter: failed to send the confirmation email")
        })
      }

      await db.insert(auditLogs).values({
        entityType: "newsletter_contact",
        entityId: contact.id,
        action: "newsletter.subscribe_requested",
        newValue: { segments: parsed.data.segments, source: parsed.data.source ?? null },
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      })

      return reply.code(202).send({
        message:
          "Vérifiez votre boîte mail : votre inscription doit être confirmée par le lien que nous venons d'envoyer.",
      })
    },
  )

  /**
   * POST /api/newsletter/confirm — double opt-in step 2, the moment consent
   * becomes provable. Only here does the address reach the sending provider.
   *
   * The link confirms every pending opt-in of that contact, not just the ones it
   * was minted for: they were all requested for the same address, and whoever
   * holds the mailbox has just proven it.
   */
  fastify.post("/confirm", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const parsed = newsletterConfirmSchema.safeParse(request.body)
    if (!parsed.success) return validationError(reply, parsed.error.issues)

    const now = new Date()
    const [token] = await db
      .select()
      .from(newsletterTokens)
      .where(
        and(
          eq(newsletterTokens.tokenHash, hashLinkToken(parsed.data.token)),
          eq(newsletterTokens.purpose, "confirm"),
          isNull(newsletterTokens.usedAt),
          gt(newsletterTokens.expiresAt, now),
        ),
      )
      .limit(1)
    if (!token) return invalidToken(reply)

    const [contact] = await db
      .select({ id: newsletterContacts.id, email: newsletterContacts.email })
      .from(newsletterContacts)
      .where(eq(newsletterContacts.id, token.contactId))
      .limit(1)
    if (!contact?.email) return invalidToken(reply)

    await db
      .update(newsletterSubscriptions)
      .set({ status: "confirmed", confirmedAt: now, unsubscribedAt: null })
      .where(and(eq(newsletterSubscriptions.contactId, contact.id), eq(newsletterSubscriptions.status, "pending")))

    await db.update(newsletterTokens).set({ usedAt: now }).where(eq(newsletterTokens.id, token.id))

    const segments = await confirmedSegments(contact.id)
    await syncProvider(request, contact.id, contact.email, segments)

    await db.insert(auditLogs).values({
      entityType: "newsletter_contact",
      entityId: contact.id,
      action: "newsletter.confirmed",
      newValue: { segments },
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    })

    const unsubscribeToken = await issueUnsubscribeToken(contact.id)
    return reply.code(200).send({ data: { segments, unsubscribeToken } })
  })

  /**
   * GET /api/newsletter/subscription?token=… — what the unsubscribe page renders.
   * Returns the segments only: the address itself is never echoed back, so a
   * leaked link discloses nothing beyond what its holder already has.
   */
  fastify.get(
    "/subscription",
    { config: { rateLimit: { max: 30, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const parsed = newsletterTokenSchema.safeParse((request.query as { token?: unknown }).token)
      if (!parsed.success) return validationError(reply, parsed.error.issues)

      const contactId = await contactIdForUnsubscribeToken(parsed.data)
      if (!contactId) return invalidToken(reply)

      const rows = await db
        .select({ segment: newsletterSubscriptions.segment, status: newsletterSubscriptions.status })
        .from(newsletterSubscriptions)
        .where(
          and(eq(newsletterSubscriptions.contactId, contactId), ne(newsletterSubscriptions.status, "unsubscribed")),
        )

      return reply.code(200).send({ data: { segments: rows } })
    },
  )

  /**
   * POST /api/newsletter/unsubscribe — withdraw consent, per segment or entirely.
   *
   * The token is NOT single-use: it travels in every letter and must keep working
   * as long as the address exists. When the last segment goes, the address is
   * **purged** — row kept, anonymised, so the consent history stays provable.
   */
  fastify.post(
    "/unsubscribe",
    { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const parsed = newsletterUnsubscribeSchema.safeParse(request.body)
      if (!parsed.success) return validationError(reply, parsed.error.issues)

      const contactId = await contactIdForUnsubscribeToken(parsed.data.token)
      if (!contactId) return invalidToken(reply)

      const [contact] = await db
        .select({ id: newsletterContacts.id, email: newsletterContacts.email })
        .from(newsletterContacts)
        .where(eq(newsletterContacts.id, contactId))
        .limit(1)
      if (!contact?.email) return invalidToken(reply)

      const now = new Date()
      const targeted = parsed.data.segments
      await db
        .update(newsletterSubscriptions)
        .set({ status: "unsubscribed", unsubscribedAt: now, providerSyncedAt: null })
        .where(
          and(
            eq(newsletterSubscriptions.contactId, contact.id),
            ne(newsletterSubscriptions.status, "unsubscribed"),
            ...(targeted ? [inArray(newsletterSubscriptions.segment, targeted)] : []),
          ),
        )

      // "Still wanted" counts pending opt-ins too: an unconfirmed segment is a
      // request in flight, not a consent to erase along the way.
      const [remaining] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(newsletterSubscriptions)
        .where(
          and(
            eq(newsletterSubscriptions.contactId, contact.id),
            or(eq(newsletterSubscriptions.status, "confirmed"), eq(newsletterSubscriptions.status, "pending")),
          ),
        )

      const stillSubscribed = (remaining?.count ?? 0) > 0
      const segments = stillSubscribed ? await confirmedSegments(contact.id) : []
      await syncProvider(request, contact.id, contact.email, segments)

      if (!stillSubscribed) {
        // GDPR purge: the address goes, the anonymised trace (hash + consent and
        // withdrawal timestamps) stays. Tokens go with it, so the links in mails
        // already delivered stop resolving to anything.
        await db
          .update(newsletterContacts)
          .set({ email: null, unsubscribedAt: now, updatedAt: now })
          .where(eq(newsletterContacts.id, contact.id))
        await db.delete(newsletterTokens).where(eq(newsletterTokens.contactId, contact.id))
      }

      await db.insert(auditLogs).values({
        entityType: "newsletter_contact",
        entityId: contact.id,
        action: "newsletter.unsubscribed",
        newValue: { segments: targeted ?? "all", purged: !stillSubscribed },
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      })

      return reply.code(200).send({ data: { segments, purged: !stillSubscribed } })
    },
  )
}

/** Resolve an unsubscribe link to its contact. Never expires; never consumed. */
async function contactIdForUnsubscribeToken(token: string): Promise<string | null> {
  const [row] = await db
    .select({ contactId: newsletterTokens.contactId })
    .from(newsletterTokens)
    .where(and(eq(newsletterTokens.tokenHash, hashLinkToken(token)), eq(newsletterTokens.purpose, "unsubscribe")))
    .limit(1)
  return row?.contactId ?? null
}
