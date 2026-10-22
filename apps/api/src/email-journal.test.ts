import { CURRENT_RGPD_CONSENT_VERSION, CURRENT_TERMS_VERSION } from "@armurier/shared"
import { eq, inArray, like } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { db } from "./db/client.js"
import { auditLogs, orders, users } from "./db/schema.js"

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }))
vi.mock("nodemailer", () => ({ createTransport: () => ({ sendMail }) }))

const { sendErrorAlertEmail, sendNewsletterConfirmationEmail, sendOrderConfirmationEmail, sendPasswordResetEmail } =
  await import("./email.js")

const EMAIL_PREFIX = "email-journal-"
const RECIPIENT = `${EMAIL_PREFIX}jean@example.fr`

describe("e-mail journal (story 12.7c)", () => {
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

  const journal = () => db.select().from(auditLogs).where(like(auditLogs.action, "email.%"))

  const confirmation = () =>
    sendOrderConfirmationEmail(RECIPIENT, {
      orderId,
      orderRef: orderId.slice(0, 8).toUpperCase(),
      placedAt: new Date("2026-10-18T10:00:00Z"),
      firstName: "Jean",
      lines: [{ name: "Tapis de tir", qty: 1 }],
      subtotalHt: 100,
      shippingHt: 0,
      vipDiscount: 0,
      vat: 20,
      totalTtc: 120,
      cardTtc: 120,
      transferTtc: 0,
      transferReference: null,
      requiresLegalVerification: false,
      paymentDueAt: new Date(),
      shippingAddress: ["Jean Tireur"],
      termsVersion: CURRENT_TERMS_VERSION,
    })

  beforeAll(async () => {
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
    sendMail.mockReset().mockResolvedValue({ messageId: "<abc-123@scs-firearms.fr>" })
  })

  afterAll(cleanup)

  it("records an order e-mail in the order's history, with its recipient and SMTP message id", async () => {
    await confirmation()

    expect(await journal()).toEqual([
      expect.objectContaining({
        action: "email.order_confirmation.sent",
        orderId,
        entityType: "order",
        entityId: orderId,
        userRole: "system",
        result: "success",
        messageId: "<abc-123@scs-firearms.fr>",
        newValue: { recipient: RECIPIENT },
      }),
    ])
  })

  it("records an e-mail outside any order against the user it was for", async () => {
    await sendPasswordResetEmail(RECIPIENT, "token", { userId })

    const [event] = await journal()
    expect(event).toMatchObject({
      action: "email.password_reset.sent",
      orderId: null,
      entityType: "user",
      entityId: userId,
    })
  })

  it("records a newsletter confirmation against its contact", async () => {
    const contactId = crypto.randomUUID()
    await sendNewsletterConfirmationEmail(
      RECIPIENT,
      { confirmToken: "c", unsubscribeToken: "u", segmentLabels: ["Armurerie"] },
      { contactId },
    )

    const [event] = await journal()
    expect(event).toMatchObject({ entityType: "newsletter_contact", entityId: contactId })
  })

  it("records a refused send as a failure with the SMTP code, and still lets the caller know", async () => {
    sendMail.mockRejectedValue(Object.assign(new Error("Mailbox unavailable"), { code: "EENVELOPE" }))

    await expect(confirmation()).rejects.toThrow("Mailbox unavailable")
    expect(await journal()).toEqual([
      expect.objectContaining({
        action: "email.order_confirmation.failed",
        result: "failure",
        error: "smtp.EENVELOPE",
        messageId: null,
      }),
    ])
  })

  it("never fails an e-mail that left because its journal line could not be written", async () => {
    sendMail.mockResolvedValue({ messageId: "<orphan@scs-firearms.fr>" })
    const warning = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined)

    // An order that does not exist: the journal insert breaks its foreign key.
    await expect(
      sendPasswordResetEmail(RECIPIENT, "token", { userId, orderId: crypto.randomUUID() }),
    ).resolves.toBeUndefined()
    expect(warning).toHaveBeenCalledTimes(1)
    warning.mockRestore()
  })

  it("keeps internal alerts out of the journal: they concern no customer", async () => {
    await sendErrorAlertEmail(["admin@scs.local"], {
      method: "GET",
      url: "/x",
      statusCode: 500,
      reqId: "r",
      message: "boom",
      occurrences: 1,
    } as never)

    expect(await journal()).toEqual([])
  })

  it("finds the journal line by its message id", async () => {
    await confirmation()
    const [event] = await db.select().from(auditLogs).where(eq(auditLogs.messageId, "<abc-123@scs-firearms.fr>"))
    expect(event?.orderId).toBe(orderId)
  })
})
