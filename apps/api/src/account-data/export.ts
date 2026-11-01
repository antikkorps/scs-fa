// Story 12.11 — everything an account holds, in one JSON document: the right of
// access and the right to data portability (GDPR art. 15 and 20) in
// self-service. Only what concerns the person: never a password or app secret,
// never an internal storage key, never an admin's notes about them.
import { asc, desc, eq } from "drizzle-orm"
import { db } from "../db/client.js"
import {
  addresses,
  legalDocuments,
  newsletterContacts,
  newsletterSubscriptions,
  orders,
  quoteRequests,
  users,
} from "../db/schema.js"
import { newsletterEmailHash } from "../newsletter/contact.js"

export async function buildAccountExport(userId: string, now: Date) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user) return null

  const [addressRows, orderRows, quoteRows, documentRows, newsletterRows] = await Promise.all([
    db
      .select({
        label: addresses.label,
        type: addresses.type,
        firstName: addresses.firstName,
        lastName: addresses.lastName,
        line1: addresses.line1,
        line2: addresses.line2,
        postal: addresses.postal,
        city: addresses.city,
        country: addresses.country,
        phone: addresses.phone,
        isDefault: addresses.isDefault,
        createdAt: addresses.createdAt,
      })
      .from(addresses)
      .where(eq(addresses.userId, userId))
      .orderBy(asc(addresses.createdAt)),
    db
      .select({
        id: orders.id,
        createdAt: orders.createdAt,
        items: orders.itemsJson,
        subtotalHt: orders.subtotalHt,
        vatAmount: orders.vatAmount,
        totalTtc: orders.totalTtc,
        vipDiscountAmount: orders.vipDiscountAmount,
        promoCode: orders.promoCode,
        promoDiscountAmount: orders.promoDiscountAmount,
        shippingMethod: orders.shippingMethod,
        shippingHt: orders.shippingHt,
        shippingAddress: orders.shippingAddress,
        billingAddress: orders.billingAddress,
        paymentStatus: orders.paymentStatus,
        paymentTerms: orders.paymentTerms,
        shippingStatus: orders.shippingStatus,
        legalVerificationStatus: orders.legalVerificationStatus,
        termsVersion: orders.termsVersion,
        termsAcceptedAt: orders.termsAcceptedAt,
      })
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt)),
    db
      .select({
        number: quoteRequests.number,
        status: quoteRequests.status,
        message: quoteRequests.message,
        totalTtc: quoteRequests.totalTtc,
        createdAt: quoteRequests.createdAt,
        sentAt: quoteRequests.sentAt,
        validUntil: quoteRequests.validUntil,
        acceptedAt: quoteRequests.acceptedAt,
      })
      .from(quoteRequests)
      .where(eq(quoteRequests.requestedBy, userId))
      .orderBy(desc(quoteRequests.createdAt)),
    db
      .select({
        type: legalDocuments.docType,
        number: legalDocuments.docNumber,
        status: legalDocuments.verificationStatus,
        issuedAt: legalDocuments.issuedAt,
        expiresAt: legalDocuments.expiresAt,
        uploadedAt: legalDocuments.uploadedAt,
        verifiedAt: legalDocuments.verifiedAt,
        rejectionReason: legalDocuments.rejectionReason,
      })
      .from(legalDocuments)
      .where(eq(legalDocuments.userId, userId))
      .orderBy(desc(legalDocuments.uploadedAt)),
    db
      .select({
        segment: newsletterSubscriptions.segment,
        status: newsletterSubscriptions.status,
        requestedAt: newsletterSubscriptions.requestedAt,
        confirmedAt: newsletterSubscriptions.confirmedAt,
        unsubscribedAt: newsletterSubscriptions.unsubscribedAt,
        consentSource: newsletterSubscriptions.consentSource,
        consentIp: newsletterSubscriptions.consentIp,
        consentUserAgent: newsletterSubscriptions.consentUserAgent,
      })
      .from(newsletterSubscriptions)
      .innerJoin(newsletterContacts, eq(newsletterContacts.id, newsletterSubscriptions.contactId))
      .where(eq(newsletterContacts.emailHash, newsletterEmailHash(user.email)))
      .orderBy(asc(newsletterSubscriptions.segment)),
  ])

  return {
    exportedAt: now.toISOString(),
    account: {
      email: user.email,
      firstName: user.firstname,
      lastName: user.lastname,
      phone: user.phone,
      address: {
        street: user.addressStreet,
        postal: user.addressPostal,
        city: user.addressCity,
        country: user.addressCountry,
      },
      role: user.role,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      twoFactorEnabled: user.totpEnabledAt !== null,
      vip: { status: user.vipStatus, active: user.vipActive, eligibleSince: user.vipEligibleSince },
    },
    consents: {
      privacyPolicy: { version: user.rgpdConsentVersion, acceptedAt: user.rgpdConsentAt },
    },
    addresses: addressRows,
    orders: orderRows,
    quoteRequests: quoteRows,
    legalDocuments: documentRows,
    newsletter: newsletterRows,
  }
}
