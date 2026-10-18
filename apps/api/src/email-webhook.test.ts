import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { and, eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildApp } from "./app.js"
import { recordAuditEvent } from "./audit/record.js"
import { db } from "./db/client.js"
import { auditLogs, orders, users } from "./db/schema.js"

const EMAIL_PREFIX = "brevo-webhook-"
const RECIPIENT = `${EMAIL_PREFIX}jean@example.fr`
const SECRET = process.env.BREVO_WEBHOOK_SECRET ?? ""
const MESSAGE_ID = "<order-confirmation-1@scs-firearms.fr>"

describe("Brevo delivery reports (story 12.7c)", () => {
  let app: FastifyInstance
  let userId: string
  let orderId: string

  async function cleanup() {
    const userIds = db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `${EMAIL_PREFIX}%`))
    await db.delete(auditLogs).where(like(auditLogs.action, "email.%"))
    await db.delete(orders).where(inArray(orders.userId, userIds))
    await db.delete(users).where(like(users.email, `${EMAIL_PREFIX}%`))
  }

  const report = (payload: unknown, token: string | null = SECRET) =>
    app.inject({
      method: "POST",
      url: "/api/webhooks/brevo",
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
      payload: payload as Record<string, unknown>,
    })

  const brevoEvent = (event: string, messageId = MESSAGE_ID) => ({
    event,
    email: RECIPIENT,
    id: 42,
    date: "2026-10-18 12:00:00",
    "message-id": messageId,
    reason: "550 5.1.1 jean@example.fr: user unknown",
    subject: "Votre commande",
  })

  const reportsOf = (messageId = MESSAGE_ID) =>
    db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.messageId, messageId), like(auditLogs.action, "email.%")))
      .orderBy(auditLogs.createdAt)

  beforeAll(async () => {
    expect(SECRET.length).toBeGreaterThan(0)
    app = await buildApp()
    await app.ready()
    await cleanup()
    const [user] = await db
      .insert(users)
      .values({
        email: RECIPIENT,
        passwordHash: "not-a-real-hash",
        role: "customer",
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id })
    userId = user.id
    const [order] = await db
      .insert(orders)
      .values({ userId, itemsJson: [], subtotalHt: "100.00", vatAmount: "20.00", totalTtc: "120.00" })
      .returning({ id: orders.id })
    orderId = order.id
  })

  beforeEach(async () => {
    await db.delete(auditLogs).where(like(auditLogs.action, "email.%"))
    await recordAuditEvent({
      userRole: "system",
      entityType: "order",
      entityId: orderId,
      orderId,
      action: "email.order_confirmation.sent",
      messageId: MESSAGE_ID,
      newValue: { recipient: RECIPIENT },
    })
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it("adds a hard bounce to the order's history, as a failure with Brevo's event as code", async () => {
    const res = await report(brevoEvent("hard_bounce"))
    expect(res.statusCode).toBe(200)

    const [, bounce] = await reportsOf()
    expect(bounce).toMatchObject({
      action: "email.order_confirmation.hard_bounce",
      orderId,
      entityType: "order",
      entityId: orderId,
      userRole: "system",
      result: "failure",
      error: "brevo.hard_bounce",
      newValue: { recipient: RECIPIENT },
    })
  })

  it("records a delivery as a success", async () => {
    await report(brevoEvent("delivered"))
    const [, delivered] = await reportsOf()
    expect(delivered).toMatchObject({ action: "email.order_confirmation.delivered", result: "success", error: null })
  })

  it("records spam complaints, blocks, invalid addresses and errors", async () => {
    for (const event of ["spam", "blocked", "invalid_email", "error"]) await report(brevoEvent(event))
    expect((await reportsOf()).map((row) => row.action)).toEqual([
      "email.order_confirmation.sent",
      "email.order_confirmation.spam",
      "email.order_confirmation.blocked",
      "email.order_confirmation.invalid_email",
      "email.order_confirmation.error",
    ])
  })

  it("is idempotent: a report Brevo sends again is recorded once", async () => {
    await report(brevoEvent("hard_bounce"))
    await report(brevoEvent("hard_bounce"))
    expect(await reportsOf()).toHaveLength(2)
  })

  it("accepts a batch of reports", async () => {
    const res = await report([brevoEvent("delivered"), brevoEvent("spam")])
    expect(res.statusCode).toBe(200)
    expect(await reportsOf()).toHaveLength(3)
  })

  it("ignores passing and engagement events, and e-mails it never sent", async () => {
    for (const event of ["request", "soft_bounce", "deferred", "opened", "click"]) {
      expect((await report(brevoEvent(event))).statusCode).toBe(200)
    }
    expect((await report(brevoEvent("hard_bounce", "<unknown@elsewhere>"))).statusCode).toBe(200)
    expect(await reportsOf()).toHaveLength(1)
    expect(await reportsOf("<unknown@elsewhere>")).toEqual([])
  })

  it("refuses a caller without the shared token, before reading anything", async () => {
    expect((await report(brevoEvent("hard_bounce"), null)).statusCode).toBe(401)
    expect((await report(brevoEvent("hard_bounce"), "wrong-token")).statusCode).toBe(401)
    expect(await reportsOf()).toHaveLength(1)
  })

  it("refuses a malformed report", async () => {
    expect((await report({ nothing: true })).statusCode).toBe(400)
  })
})
