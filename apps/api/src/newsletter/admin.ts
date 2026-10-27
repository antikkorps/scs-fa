// Back-office view of the newsletter subscribers: how many per segment and
// status, and who, with the proof of each consent. Read-only — letters are
// written and sent from the provider (Brevo), and a contact leaves through the
// unsubscribe link of every letter. Anonymised traces (address erased after a
// full unsubscribe) are counted but never listed: nothing about them is personal.

import {
  type AdminNewsletterQuery,
  adminNewsletterQuerySchema,
  NEWSLETTER_SEGMENTS,
  NEWSLETTER_SUBSCRIPTION_STATUS,
  type NewsletterSegment,
  type NewsletterSubscriptionStatus,
} from "@armurier/shared"
import { and, asc, count, desc, eq, exists, ilike, inArray, isNotNull, isNull } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import { db } from "../db/client.js"
import { containsPattern } from "../db/like.js"
import { newsletterContacts, newsletterSubscriptions } from "../db/schema.js"
import { validationError } from "../http.js"

type StatusCounts = Record<NewsletterSubscriptionStatus, number>

function emptyCounts(): Record<NewsletterSegment, StatusCounts> {
  const zeroes = () => Object.fromEntries(NEWSLETTER_SUBSCRIPTION_STATUS.map((status) => [status, 0])) as StatusCounts
  return Object.fromEntries(NEWSLETTER_SEGMENTS.map((segment) => [segment, zeroes()])) as Record<
    NewsletterSegment,
    StatusCounts
  >
}

/** Contacts that still hold an address and match the filters (on one same subscription). */
function listedContacts({ segment, status, search }: AdminNewsletterQuery) {
  const subscriptionFilters = [
    segment ? eq(newsletterSubscriptions.segment, segment) : undefined,
    status ? eq(newsletterSubscriptions.status, status) : undefined,
  ].filter(Boolean)
  return and(
    isNotNull(newsletterContacts.email),
    search ? ilike(newsletterContacts.email, containsPattern(search)) : undefined,
    subscriptionFilters.length
      ? exists(
          db
            .select({ contactId: newsletterSubscriptions.contactId })
            .from(newsletterSubscriptions)
            .where(and(eq(newsletterSubscriptions.contactId, newsletterContacts.id), ...subscriptionFilters)),
        )
      : undefined,
  )
}

export const adminNewsletterRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  /** GET /summary — subscriptions per segment × status, contacts with an address, confirmations not yet at the provider. */
  fastify.get("/summary", async (_request, reply) => {
    const [bySegment, [{ contacts }], [{ awaitingSync }]] = await Promise.all([
      db
        .select({ segment: newsletterSubscriptions.segment, status: newsletterSubscriptions.status, n: count() })
        .from(newsletterSubscriptions)
        .groupBy(newsletterSubscriptions.segment, newsletterSubscriptions.status),
      db.select({ contacts: count() }).from(newsletterContacts).where(isNotNull(newsletterContacts.email)),
      db
        .select({ awaitingSync: count() })
        .from(newsletterSubscriptions)
        .where(and(eq(newsletterSubscriptions.status, "confirmed"), isNull(newsletterSubscriptions.providerSyncedAt))),
    ])

    const segments = emptyCounts()
    for (const row of bySegment) segments[row.segment][row.status] = row.n

    return reply.send({ data: { segments, contacts, awaitingSync } })
  })

  /** GET /?segment=&status=&search=&page=&limit= — contacts, newest first, with all their subscriptions. */
  fastify.get("/", async (request, reply) => {
    const parsed = adminNewsletterQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const { page, limit } = parsed.data
    const where = listedContacts(parsed.data)

    const [[{ total }], contacts] = await Promise.all([
      db.select({ total: count() }).from(newsletterContacts).where(where),
      db
        .select({ id: newsletterContacts.id, email: newsletterContacts.email, createdAt: newsletterContacts.createdAt })
        .from(newsletterContacts)
        .where(where)
        .orderBy(desc(newsletterContacts.createdAt), asc(newsletterContacts.id))
        .limit(limit)
        .offset((page - 1) * limit),
    ])

    const subscriptions = contacts.length
      ? await db
          .select()
          .from(newsletterSubscriptions)
          .where(
            inArray(
              newsletterSubscriptions.contactId,
              contacts.map((contact) => contact.id),
            ),
          )
          .orderBy(asc(newsletterSubscriptions.segment))
      : []

    const data = contacts.map((contact) => ({
      ...contact,
      subscriptions: subscriptions
        .filter((subscription) => subscription.contactId === contact.id)
        .map((subscription) => ({
          segment: subscription.segment,
          status: subscription.status,
          requestedAt: subscription.requestedAt,
          confirmedAt: subscription.confirmedAt,
          unsubscribedAt: subscription.unsubscribedAt,
          consentSource: subscription.consentSource,
          consentIp: subscription.consentIp,
          synced: subscription.providerSyncedAt !== null,
        })),
    }))

    return reply.send({
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: page * limit < total },
    })
  })
}
