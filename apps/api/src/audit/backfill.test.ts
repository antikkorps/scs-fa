import { readFileSync } from "node:fs"
import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { eq, inArray, like, sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db } from "../db/client.js"
import { auditLogs, orders, paymentVirement, shipments, users } from "../db/schema.js"

const EMAIL_PREFIX = "audit-backfill-"
const MIGRATION = new URL("../../drizzle/0025_story_12_7b_order_history.sql", import.meta.url)

/** The migration's backfill statements, replayed on rows written the old way. */
async function runBackfill() {
  const statements = readFileSync(MIGRATION, "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.startsWith("UPDATE"))
  expect(statements.length).toBeGreaterThan(0)
  for (const statement of statements) await db.execute(sql.raw(statement))
}

describe("audit_logs order_id backfill (story 12.7b)", () => {
  let userId: string
  let orderId: string
  const legacy: Record<string, string> = {}

  async function cleanup() {
    const userIds = db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `${EMAIL_PREFIX}%`))
    const orderIds = db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, userIds))
    await db.delete(auditLogs).where(like(auditLogs.action, "backfill.%"))
    await db.delete(shipments).where(inArray(shipments.orderId, orderIds))
    await db.delete(paymentVirement).where(inArray(paymentVirement.orderId, orderIds))
    await db.delete(orders).where(inArray(orders.userId, userIds))
    await db.delete(users).where(like(users.email, `${EMAIL_PREFIX}%`))
  }

  async function legacyRow(name: string, values: Omit<typeof auditLogs.$inferInsert, "action">) {
    const [row] = await db
      .insert(auditLogs)
      .values({ ...values, action: `backfill.${name}` })
      .returning({ id: auditLogs.id })
    legacy[name] = row.id
  }

  async function orderIdOf(name: string) {
    const [row] = await db.select({ orderId: auditLogs.orderId }).from(auditLogs).where(eq(auditLogs.id, legacy[name]))
    return row.orderId
  }

  beforeAll(async () => {
    await cleanup()
    const [user] = await db
      .insert(users)
      .values({
        email: `${EMAIL_PREFIX}customer@audit.local`,
        passwordHash: "not-a-real-hash",
        role: "customer",
        firstname: "Audit",
        lastname: "Client",
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id })
    userId = user.id
    const [order] = await db
      .insert(orders)
      .values({ userId, itemsJson: [], subtotalHt: "10.00", vatAmount: "2.00", totalTtc: "12.00" })
      .returning({ id: orders.id })
    orderId = order.id
    const [parcel] = await db
      .insert(shipments)
      .values({ orderId, position: 1, carrier: "colissimo" })
      .returning({ id: shipments.id })
    const [transfer] = await db
      .insert(paymentVirement)
      .values({ orderId, amountExpectedTtc: "12.00", ibanRecipient: "FR7630006000011234567890189" })
      .returning({ id: paymentVirement.id })

    await legacyRow("new-value", { entityType: "refund", entityId: crypto.randomUUID(), newValue: { orderId } })
    await legacyRow("old-value", { entityType: "shipment", entityId: crypto.randomUUID(), oldValue: { orderId } })
    await legacyRow("order", { entityType: "order", entityId: orderId })
    await legacyRow("shipment", { entityType: "shipment", entityId: parcel.id, newValue: { status: "shipped" } })
    await legacyRow("transfer", { entityType: "payment_virement", entityId: transfer.id })
    await legacyRow("legal-document", { entityType: "legal_document", entityId: crypto.randomUUID() })
    await legacyRow("gone", { entityType: "refund", newValue: { orderId: crypto.randomUUID() } })
    await legacyRow("not-a-uuid", { entityType: "refund", newValue: { orderId: "0B7D1F3E" } })

    await runBackfill()
  })

  afterAll(cleanup)

  it("takes the order from newValue.orderId, then oldValue.orderId", async () => {
    expect(await orderIdOf("new-value")).toBe(orderId)
    expect(await orderIdOf("old-value")).toBe(orderId)
  })

  it("takes the order from the entity: the order itself, its parcel, its transfer", async () => {
    expect(await orderIdOf("order")).toBe(orderId)
    expect(await orderIdOf("shipment")).toBe(orderId)
    expect(await orderIdOf("transfer")).toBe(orderId)
  })

  it("leaves NULL when no order can be found: a customer's document, a deleted order, a malformed id", async () => {
    expect(await orderIdOf("legal-document")).toBeNull()
    expect(await orderIdOf("gone")).toBeNull()
    expect(await orderIdOf("not-a-uuid")).toBeNull()
  })
})
