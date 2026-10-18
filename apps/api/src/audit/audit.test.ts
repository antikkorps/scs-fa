import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { eq, inArray, like, sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db } from "../db/client.js"
import { auditLogs, orders, users } from "../db/schema.js"
import { currentReqId, runWithRequestContext } from "./context.js"
import { recordAuditEvent } from "./record.js"

const EMAIL_PREFIX = "audit-helper-"

describe("audit event helper (story 12.7b)", () => {
  let userId: string
  let orderId: string

  async function cleanup() {
    const userIds = db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `${EMAIL_PREFIX}%`))
    const orderIds = db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, userIds))
    await db.delete(auditLogs).where(inArray(auditLogs.orderId, orderIds))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
    await db.delete(orders).where(inArray(orders.userId, userIds))
    await db.delete(users).where(like(users.email, `${EMAIL_PREFIX}%`))
  }

  async function eventsOf(order: string) {
    return db.select().from(auditLogs).where(eq(auditLogs.orderId, order))
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
  })

  afterAll(cleanup)

  it("records a successful event against its order by default", async () => {
    await recordAuditEvent({ entityType: "order", entityId: orderId, orderId, action: "test.success", userId })

    const [event] = (await eventsOf(orderId)).filter((row) => row.action === "test.success")
    expect(event).toMatchObject({ orderId, userId, result: "success", error: null, reqId: null })
  })

  it("records a failure with its short error code", async () => {
    await recordAuditEvent({
      entityType: "order",
      entityId: orderId,
      orderId,
      action: "test.failure",
      result: "failure",
      error: "henrri.Timeout",
    })

    const [event] = (await eventsOf(orderId)).filter((row) => row.action === "test.failure")
    expect(event).toMatchObject({ result: "failure", error: "henrri.Timeout" })
  })

  it("never stores free text as an error code: it could carry personal data", async () => {
    await recordAuditEvent({
      entityType: "order",
      orderId,
      action: "test.free-text",
      result: "failure",
      error: "Mail refused for jean.dupont@example.com",
    })

    const [event] = (await eventsOf(orderId)).filter((row) => row.action === "test.free-text")
    expect(event.error).toBe("invalid_error_code")
  })

  it("takes the request id from the request context", async () => {
    await runWithRequestContext({ reqId: "req-12-7b" }, () =>
      recordAuditEvent({ entityType: "order", orderId, action: "test.req-id" }),
    )

    const [event] = (await eventsOf(orderId)).filter((row) => row.action === "test.req-id")
    expect(event.reqId).toBe("req-12-7b")
  })

  it("keeps neither IP nor user-agent on an order event: the history is kept 10 years", async () => {
    await recordAuditEvent({
      entityType: "order",
      orderId,
      action: "test.no-ip",
      ipAddress: "203.0.113.7",
      userAgent: "Mozilla/5.0",
    })

    const [event] = (await eventsOf(orderId)).filter((row) => row.action === "test.no-ip")
    expect(event).toMatchObject({ ipAddress: null, userAgent: null })
  })

  it("keeps IP and user-agent on an event outside any order (security trail)", async () => {
    await recordAuditEvent({
      userId,
      entityType: "user",
      entityId: userId,
      action: "test.login",
      ipAddress: "203.0.113.7",
      userAgent: "Mozilla/5.0",
    })

    const [event] = await db.select().from(auditLogs).where(eq(auditLogs.action, "test.login"))
    expect(event).toMatchObject({ orderId: null, ipAddress: "203.0.113.7", userAgent: "Mozilla/5.0" })
  })

  it("writes inside the caller's transaction", async () => {
    await db
      .transaction(async (tx) => {
        await recordAuditEvent({ entityType: "order", orderId, action: "test.rolled-back" }, tx)
        tx.rollback()
      })
      .catch(() => undefined)

    expect((await eventsOf(orderId)).some((row) => row.action === "test.rolled-back")).toBe(false)
  })

  it("dates each event when it happens, so a transaction's events keep their order", async () => {
    await db.transaction(async (tx) => {
      await recordAuditEvent({ entityType: "order", orderId, action: "test.first" }, tx)
      await recordAuditEvent({ entityType: "order", orderId, action: "test.second" }, tx)
    })

    // Compared in the database: its timestamps are finer than a JavaScript Date.
    const { rows } = await db.execute<{ inOrder: boolean }>(sql`
      SELECT second.created_at > first.created_at AS "inOrder"
      FROM audit_logs first, audit_logs second
      WHERE first.order_id = ${orderId} AND first.action = 'test.first'
        AND second.order_id = ${orderId} AND second.action = 'test.second'`)
    expect(rows).toEqual([{ inOrder: true }])
  })

  it("keeps the event when its order is deleted, only the link is dropped", async () => {
    const [doomed] = await db
      .insert(orders)
      .values({ userId, itemsJson: [], subtotalHt: "1.00", vatAmount: "0.20", totalTtc: "1.20" })
      .returning({ id: orders.id })
    await recordAuditEvent({
      userId,
      entityType: "order",
      entityId: doomed.id,
      orderId: doomed.id,
      action: "test.orphan",
    })

    await db.delete(orders).where(eq(orders.id, doomed.id))

    const [event] = await db.select().from(auditLogs).where(eq(auditLogs.action, "test.orphan"))
    expect(event).toMatchObject({ entityId: doomed.id, orderId: null })
  })
})

describe("request context", () => {
  it("has no request id outside a request (scheduled jobs)", () => {
    expect(currentReqId()).toBeNull()
  })
})
