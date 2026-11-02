// Story 12.11 — erasing an account (GDPR art. 17). The row cannot go: orders,
// quotes and the audit trail point at it and are kept for 10 years. So the
// account is anonymised in place, and everything that only served the account
// (address book, carts, sessions, codes, newsletter address, documents no order
// relied on) is deleted. One function for both paths: the holder's request and
// the inactivity purge.
import { type AccountDeletionBlocker, WITHDRAWAL_PERIOD_DAYS } from "@armurier/shared"
import { and, eq, inArray, isNotNull, isNull, lte, ne, notInArray, or, sql } from "drizzle-orm"
import { releasePrintFromCart } from "../artworks/reservation.js"
import { daysBefore } from "../dates.js"
import { db } from "../db/client.js"
import {
  addresses,
  artworkCartItems,
  auditLogs,
  cartItems,
  contactMessages,
  legalDocuments,
  loginChallenges,
  newsletterContacts,
  newsletterSubscriptions,
  newsletterTokens,
  orders,
  passwordResetTokens,
  quoteBasketItems,
  quoteRequests,
  recoveryCodes,
  refreshTokens,
  shipments,
  users,
} from "../db/schema.js"
import { sendAccountDeletedEmail } from "../email.js"
import { approvedOnce } from "../legal-documents/approved-once.js"
import { newsletterEmailHash } from "../newsletter/contact.js"
import { newsletterProvider } from "../newsletter/service.js"
import { releaseAllUniquePieces } from "../products/reservation.js"
import { storage } from "../storage/index.js"

export type DeletionReason = "holder_request" | "inactivity"

/** A quote still running: asked, being priced, sent, or accepted and not yet an order. */
const OPEN_QUOTE_STATUSES = ["requested", "in_review", "sent", "accepted"] as const

/** A deleted account's address: unique, and on a domain that can never receive mail (RFC 2606). */
export function anonymisedEmail(userId: string): string {
  return `deleted-${userId}@deleted.invalid`
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Executor = typeof db | Tx

/** Why this account cannot be deleted by its holder now, or null when it can. */
export async function deletionBlocker(
  user: { id: string; role: string; organisationId: string | null },
  now: Date,
  executor: Executor = db,
): Promise<AccountDeletionBlocker | null> {
  if (user.role !== "customer") return "AdminAccount"
  if (user.organisationId) return "OrganisationAccount"

  // An order is over once cancelled or refunded, or delivered with its withdrawal
  // period past (dated by its last delivery, else by its last change).
  const lastDelivery = executor
    .select({ at: sql`max(${shipments.deliveredAt})` })
    .from(shipments)
    .where(eq(shipments.orderId, orders.id))
  const [running] = await executor
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.userId, user.id),
        notInArray(orders.paymentStatus, ["cancelled", "refunded"]),
        or(
          ne(orders.shippingStatus, "delivered"),
          sql`coalesce((${lastDelivery}), ${orders.updatedAt}) > ${daysBefore(now, WITHDRAWAL_PERIOD_DAYS)}`,
        ),
      ),
    )
    .limit(1)
  if (running) return "OrderInProgress"

  const [openQuote] = await executor
    .select({ id: quoteRequests.id })
    .from(quoteRequests)
    .where(and(eq(quoteRequests.requestedBy, user.id), inArray(quoteRequests.status, [...OPEN_QUOTE_STATUSES])))
    .limit(1)
  if (openQuote) return "QuoteInProgress"

  return null
}

export interface ErasedAccount {
  /** The address the account had, for the confirmation e-mail and the newsletter provider. */
  formerEmail: string
  /** Storage keys of the documents erased: their files go once the transaction holds. */
  erasedDocumentKeys: string[]
  documentsKept: number
  /** The newsletter address was erased too: the sending provider must forget it. */
  newsletterErased: boolean
}

/**
 * Anonymise an account and delete what only served it. Returns null when the
 * account does not exist or is already deleted (idempotent), and the blocker
 * when it may not go now — checked here, under the account's row lock, so the
 * check and the erasure see the same orders.
 */
export async function eraseAccount(
  userId: string,
  now: Date,
): Promise<ErasedAccount | { blocker: AccountDeletionBlocker } | null> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: users.id, email: users.email, role: users.role, organisationId: users.organisationId })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .for("update")
    if (!user) return null
    const blocker = await deletionBlocker(user, now, tx)
    if (blocker) return { blocker }

    // Documents an order relied on: approved once (still valid or since expired),
    // and uploaded no later than the last verification of this account's orders.
    const lastVerification = tx
      .select({ at: sql`max(${orders.legalVerifiedAt})` })
      .from(orders)
      .where(eq(orders.userId, userId))
    const reliedOn = and(approvedOnce, lte(legalDocuments.uploadedAt, sql`(${lastVerification})`))
    const erasedDocuments = await tx
      .delete(legalDocuments)
      .where(and(eq(legalDocuments.userId, userId), sql`not coalesce(${reliedOn}, false)`))
      .returning({ key: legalDocuments.s3Key })
    const [{ kept }] = await tx
      .select({ kept: sql<number>`count(*)::int` })
      .from(legalDocuments)
      .where(eq(legalDocuments.userId, userId))

    // Holds go back on sale before their cart lines go.
    await releaseAllUniquePieces(userId, tx)
    const heldPrints = await tx
      .delete(artworkCartItems)
      .where(eq(artworkCartItems.userId, userId))
      .returning({ printId: artworkCartItems.printId })
    for (const { printId } of heldPrints) await releasePrintFromCart(printId, tx)

    await tx.delete(cartItems).where(eq(cartItems.userId, userId))
    await tx.delete(quoteBasketItems).where(eq(quoteBasketItems.userId, userId))
    await tx.delete(addresses).where(eq(addresses.userId, userId))
    await tx.delete(refreshTokens).where(eq(refreshTokens.userId, userId))
    await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId))
    await tx.delete(loginChallenges).where(eq(loginChallenges.userId, userId))
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId))

    const newsletterErased = await eraseNewsletterAddress(tx, user.email, now)
    // What the person wrote through the contact form, from this address.
    await tx.delete(contactMessages).where(eq(contactMessages.email, user.email))

    // The account's own journal lines keep their dates and actions (security
    // history, 1 year) but no longer what they said: names, phone, addresses.
    // An order's lines stay whole, with the order, for 10 years.
    await tx
      .update(auditLogs)
      .set({ oldValue: null, newValue: null })
      .where(
        and(
          isNull(auditLogs.orderId),
          or(eq(auditLogs.userId, userId), and(eq(auditLogs.entityType, "user"), eq(auditLogs.entityId, userId))),
        ),
      )

    await tx
      .update(users)
      .set({
        email: anonymisedEmail(userId),
        // Not a hash: no password ever verifies against it.
        passwordHash: "!deleted",
        firstname: null,
        lastname: null,
        phone: null,
        addressStreet: null,
        addressPostal: null,
        addressCity: null,
        addressCountry: null,
        legalRejectionReason: null,
        totpSecretEncrypted: null,
        totpPendingSecretEncrypted: null,
        totpEnabledAt: null,
        totpLastStep: null,
        henrriCustomerFingerprint: null,
        lastLoginAt: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastFailedLoginAt: null,
        deletedAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, userId))

    return {
      formerEmail: user.email,
      erasedDocumentKeys: erasedDocuments.map((doc) => doc.key),
      documentsKept: kept,
      newsletterErased,
    }
  })
}

/** Same end state as a full unsubscribe: the address goes, the anonymous consent trace stays. */
async function eraseNewsletterAddress(tx: Tx, email: string, now: Date): Promise<boolean> {
  const [contact] = await tx
    .select({ id: newsletterContacts.id })
    .from(newsletterContacts)
    .where(and(eq(newsletterContacts.emailHash, newsletterEmailHash(email)), isNotNull(newsletterContacts.email)))
  if (!contact) return false

  await tx
    .update(newsletterSubscriptions)
    .set({ status: "unsubscribed", unsubscribedAt: now, providerSyncedAt: null })
    .where(and(eq(newsletterSubscriptions.contactId, contact.id), ne(newsletterSubscriptions.status, "unsubscribed")))
  await tx
    .update(newsletterContacts)
    .set({ email: null, unsubscribedAt: now, updatedAt: now })
    .where(eq(newsletterContacts.id, contact.id))
  await tx.delete(newsletterTokens).where(eq(newsletterTokens.contactId, contact.id))
  return true
}

interface ErasureLogger {
  error(object: object, message: string): void
}

/**
 * What follows a committed erasure, outside the database: the erased files, the
 * newsletter provider's copy of the address, the confirmation e-mail. Each is
 * best-effort and logged: the account is already erased, and none of these may
 * undo it or make the caller retry it.
 */
export async function completeErasure(userId: string, erased: ErasedAccount, log: ErasureLogger): Promise<void> {
  for (const key of erased.erasedDocumentKeys) {
    await storage.delete(key).catch((err) => log.error({ err, userId }, "account erasure: file delete failed"))
  }
  if (erased.newsletterErased) {
    await newsletterProvider
      .deleteContact(erased.formerEmail)
      .catch((err) => log.error({ err, userId }, "account erasure: newsletter provider delete failed"))
  }
  await sendAccountDeletedEmail(erased.formerEmail, { userId }).catch((err) =>
    log.error({ err, userId }, "account erasure: confirmation e-mail failed"),
  )
}
