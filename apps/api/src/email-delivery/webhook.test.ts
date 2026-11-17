import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { and, eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { recordAuditEvent } from "../audit/record.js"
import { db } from "../db/client.js"
import { auditLogs, orders, users } from "../db/schema.js"

const EMAIL_PREFIX = "delivery-webhook-"
const RECIPIENT = `${EMAIL_PREFIX}jean@example.fr`
const SECRET = process.env.EMAIL_WEBHOOK_SECRET ?? ""
const MESSAGE_ID = "0b6f3a2e-4d1c-4f7a-9e2b-8c5d1a7f3e90"

// Runs with EMAIL_PROVIDER=mailjet (vitest.config.ts): the payloads are Mailjet's,
// everything this test asserts on is ours.
describe("e-mail delivery reports (story 12.7c)", () => {
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

  const report = (payload: unknown, secret: string | null = SECRET) =>
    app.inject({
      method: "POST",
      url: "/api/webhooks/email",
      headers: secret === null ? {} : { authorization: `Basic ${Buffer.from(`mailjet:${secret}`).toString("base64")}` },
      payload: payload as Record<string, unknown>,
    })

  // Each outcome as Mailjet's Event API reports it.
  const MAILJET_EVENTS: Record<string, Record<string, unknown>> = {
    delivered: { event: "sent", smtp_reply: "250 2.0.0 OK" },
    hard_bounce: { event: "bounce", hard_bounce: true, error_related_to: "recipient", error: "user unknown" },
    blocked: { event: "blocked", error_related_to: "recipient", error: "preblocked" },
    spam: { event: "spam", source: "JMRPP" },
    soft_bounce: { event: "bounce", hard_bounce: false },
    opened: { event: "open" },
    clicked: { event: "click" },
  }

  const providerEvent = (outcome: string, trackingId = MESSAGE_ID) => ({
    ...MAILJET_EVENTS[outcome],
    time: 1_760_788_800,
    MessageID: 1234567890,
    email: RECIPIENT,
    CustomID: trackingId,
    Payload: "",
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

  it("adds a hard bounce to the order's history, as a failure with a neutral code", async () => {
    const res = await report(providerEvent("hard_bounce"))
    expect(res.statusCode).toBe(200)

    const [, bounce] = await reportsOf()
    expect(bounce).toMatchObject({
      action: "email.order_confirmation.hard_bounce",
      orderId,
      entityType: "order",
      entityId: orderId,
      userRole: "system",
      result: "failure",
      error: "delivery.hard_bounce",
      newValue: { recipient: RECIPIENT },
    })
  })

  it("records a delivery as a success", async () => {
    await report(providerEvent("delivered"))
    const [, delivered] = await reportsOf()
    expect(delivered).toMatchObject({ action: "email.order_confirmation.delivered", result: "success", error: null })
  })

  it("records spam complaints and blocks", async () => {
    for (const outcome of ["spam", "blocked"]) await report(providerEvent(outcome))
    expect((await reportsOf()).map((row) => row.action)).toEqual([
      "email.order_confirmation.sent",
      "email.order_confirmation.spam",
      "email.order_confirmation.blocked",
    ])
  })

  it("is idempotent: a report the provider sends again is recorded once", async () => {
    await report(providerEvent("hard_bounce"))
    await report(providerEvent("hard_bounce"))
    expect(await reportsOf()).toHaveLength(2)
  })

  it("accepts a batch of reports", async () => {
    const res = await report([providerEvent("delivered"), providerEvent("spam")])
    expect(res.statusCode).toBe(200)
    expect(await reportsOf()).toHaveLength(3)
  })

  it("ignores passing and engagement events, and e-mails it never sent", async () => {
    for (const outcome of ["soft_bounce", "opened", "clicked"]) {
      expect((await report(providerEvent(outcome))).statusCode).toBe(200)
    }
    expect((await report(providerEvent("hard_bounce", "not-one-of-ours"))).statusCode).toBe(200)
    expect(await reportsOf()).toHaveLength(1)
    expect(await reportsOf("not-one-of-ours")).toEqual([])
  })

  it("refuses a caller without the shared secret, before reading anything", async () => {
    expect((await report(providerEvent("hard_bounce"), null)).statusCode).toBe(401)
    expect((await report(providerEvent("hard_bounce"), "wrong-secret")).statusCode).toBe(401)
    expect(await reportsOf()).toHaveLength(1)
  })

  it("refuses a malformed report", async () => {
    expect((await report({ nothing: true })).statusCode).toBe(400)
  })
})
