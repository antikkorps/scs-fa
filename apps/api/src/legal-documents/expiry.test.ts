import { randomUUID } from "node:crypto"
import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { and, eq, inArray, like } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { db } from "../db/client.js"
import { auditLogs, legalDocuments, orders, users } from "../db/schema.js"
import { expireLegalDocuments } from "./expiry.js"

const PREFIX = "docexpiry-test"
const TODAY = "2026-10-23"

describe("legal document expiry job (story 12.9f)", () => {
  let customerId: string

  async function cleanup() {
    const myUsers = db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `${PREFIX}%`))
    const myDocs = db
      .select({ id: legalDocuments.id })
      .from(legalDocuments)
      .where(inArray(legalDocuments.userId, myUsers))
    const myOrders = db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, myUsers))
    // System audit rows have no user: scope them by document and by order
    await db.delete(auditLogs).where(inArray(auditLogs.entityId, myDocs))
    await db.delete(auditLogs).where(inArray(auditLogs.orderId, myOrders))
    await db.delete(orders).where(inArray(orders.userId, myUsers))
    await db.delete(legalDocuments).where(inArray(legalDocuments.userId, myUsers))
    await db.delete(users).where(like(users.email, `${PREFIX}%`))
  }

  async function seedDoc(overrides: Partial<typeof legalDocuments.$inferInsert>) {
    const [row] = await db
      .insert(legalDocuments)
      .values({
        userId: customerId,
        docType: "cni",
        s3Key: `legal-documents/${customerId}/${randomUUID()}.pdf`,
        s3Url: `memory://legal-documents/${customerId}/test.pdf`,
        mimeType: "application/pdf",
        fileSize: 100,
        scanStatus: "clean",
        verificationStatus: "approved",
        ...overrides,
      } as typeof legalDocuments.$inferInsert)
      .returning()
    return row
  }

  /** An order of a category-D item (requires an identity card), still under review. */
  async function seedOrder() {
    const [order] = await db
      .insert(orders)
      .values({
        userId: customerId,
        legalVerificationStatus: "docs_verifying",
        paymentStatus: "pending",
        itemsJson: [
          {
            variantId: randomUUID(),
            qty: 1,
            priceHt: 100,
            name: "Carabine",
            sku: "EXPIRY-1",
            category: "arme-longue",
            legalCategory: "D",
            requiresPaymentVirement: false,
          },
        ] as never,
        subtotalHt: "100.00",
        vatAmount: "20.00",
        totalTtc: "120.00",
      })
      .returning({ id: orders.id })
    return order.id
  }

  async function statusOf(id: string) {
    const [row] = await db
      .select({ status: legalDocuments.verificationStatus })
      .from(legalDocuments)
      .where(eq(legalDocuments.id, id))
    return row.status
  }

  beforeEach(async () => {
    await cleanup()
    const [user] = await db
      .insert(users)
      .values({
        email: `${PREFIX}-customer@${PREFIX}.local`,
        passwordHash: "not-used",
        role: "customer",
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id })
    customerId = user.id
  })

  afterAll(cleanup)

  it("marks approved and pending documents past their expiry date as expired, and audits each", async () => {
    const approved = await seedDoc({ expiresAt: "2026-10-22" })
    const pending = await seedDoc({ expiresAt: "2026-01-31", verificationStatus: "pending" })

    const res = await expireLegalDocuments(TODAY)

    expect(res.expired).toBeGreaterThanOrEqual(2)
    expect(await statusOf(approved.id)).toBe("expired")
    expect(await statusOf(pending.id)).toBe("expired")
    const audited = await db
      .select({ entityId: auditLogs.entityId, userRole: auditLogs.userRole, oldValue: auditLogs.oldValue })
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "legal_doc_expired"), inArray(auditLogs.entityId, [approved.id, pending.id])))
    expect(audited).toHaveLength(2)
    expect(audited.find((row) => row.entityId === approved.id)).toMatchObject({
      userRole: "system",
      oldValue: { verificationStatus: "approved" },
    })
  })

  it("leaves valid, undated and already-rejected documents alone", async () => {
    // One approved document per type and customer (uniq_user_doc_type)
    const lastDay = await seedDoc({ docType: "cni", expiresAt: TODAY })
    const undated = await seedDoc({ docType: "sia", expiresAt: null })
    const rejected = await seedDoc({ expiresAt: "2026-01-31", verificationStatus: "rejected" })

    await expireLegalDocuments(TODAY)

    expect(await statusOf(lastDay.id)).toBe("approved")
    expect(await statusOf(undated.id)).toBe("approved")
    expect(await statusOf(rejected.id)).toBe("rejected")
  })

  it("sends the owner's order under review back to the customer", async () => {
    const orderId = await seedOrder()
    await seedDoc({ expiresAt: "2026-10-22" })

    await expireLegalDocuments(TODAY)

    const [order] = await db
      .select({ status: orders.legalVerificationStatus, reason: orders.legalRejectionReason })
      .from(orders)
      .where(eq(orders.id, orderId))
    expect(order).toEqual({ status: "docs_rejected", reason: "document_expired" })
  })

  it("is idempotent", async () => {
    const doc = await seedDoc({ expiresAt: "2026-10-22" })
    await expireLegalDocuments(TODAY)
    await expireLegalDocuments(TODAY)
    const audited = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "legal_doc_expired"), eq(auditLogs.entityId, doc.id)))
    expect(audited).toHaveLength(1)
  })
})
