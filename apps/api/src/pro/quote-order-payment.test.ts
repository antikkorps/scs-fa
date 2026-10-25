import { eq, inArray } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, orders, paymentCarte, paymentVirement, productVariants, quoteRequests } from "../db/schema.js"
import { sendInvoiceDueReminderEmail, sendUnpaidOrderCancelledEmail } from "../email.js"
import { remindInvoicesDue, sweepUnpaidOrders } from "../orders/expiry.js"
import { type Account, type FixtureProduct, proFixtures } from "../test/pro-fixtures.js"
import { validityDate } from "./quotes.js"

vi.mock("../email.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../email.js")>()),
  sendUnpaidOrderCancelledEmail: vi.fn().mockResolvedValue(undefined),
  sendTransferReminderEmail: vi.fn().mockResolvedValue(undefined),
  sendInvoiceDueReminderEmail: vi.fn().mockResolvedValue(undefined),
}))

const TAG = "quotepay"
const DAY_MS = 24 * 60 * 60 * 1000
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS)
const day = (date: Date) => date.toISOString().slice(0, 10)

describe("paying an order born of a quote (story 12.8d)", () => {
  let app: FastifyInstance
  let fixtures: ReturnType<typeof proFixtures>
  let pro: Account
  let admin: Account
  let sling: FixtureProduct
  let counter = 0

  /** A converted quote and its order: 2 slings, paid by card unless on invoice. */
  async function quoteOrder(options: { placedDaysAgo: number; net30?: boolean; dueAt?: Date; quoteValidUntil?: Date }) {
    counter += 1
    const [request] = await db
      .insert(quoteRequests)
      .values({
        number: `DR-QP-${Date.now() % 1e7}-${counter}`,
        organisationId: pro.organisationId as string,
        requestedBy: pro.id,
        status: "converted",
        acceptedAt: daysAgo(options.placedDaysAgo),
        acceptedBy: pro.id,
        validUntil: validityDate(day(options.quoteValidUntil ?? new Date(Date.now() + 10 * DAY_MS))),
      })
      .returning({ id: quoteRequests.id })
    const [order] = await db
      .insert(orders)
      .values({
        userId: pro.id,
        quoteRequestId: request.id,
        paymentTerms: options.net30 ? "net30" : "immediate",
        paymentDueAt: options.dueAt ?? null,
        paymentStatus: "pending",
        legalVerificationStatus: "payment_pending",
        createdAt: daysAgo(options.placedDaysAgo),
        itemsJson: [
          {
            variantId: sling.variantId,
            qty: 2,
            priceHt: 18,
            name: "Bretelle",
            sku: sling.sku,
            category: "accessoire-tireur",
            requiresPaymentVirement: false,
            vatPct: 20,
            discountHt: 0,
          },
        ],
        subtotalHt: "36.00",
        vatAmount: "7.20",
        totalTtc: "43.20",
      })
      .returning({ id: orders.id })
    if (options.net30) {
      await db.insert(paymentVirement).values({
        orderId: order.id,
        amountExpectedTtc: "43.20",
        currency: "EUR",
        ibanRecipient: "FR7630006000011234567890189",
        bicRecipient: "AGRIFRPP",
        bankName: "Banque Test",
        accountHolderName: "SCS Firearms SAS",
        paymentReference: `SCS-QP${counter}-${Date.now() % 1e4}`,
        paymentStatus: "awaiting_transfer",
      })
    } else {
      await db
        .insert(paymentCarte)
        .values({ orderId: order.id, amountTtc: "43.20", currency: "EUR", paymentStatus: "pending" })
    }
    return { orderId: order.id, quoteRequestId: request.id }
  }

  const orderOf = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0]
  const requestOf = async (id: string) => (await db.select().from(quoteRequests).where(eq(quoteRequests.id, id)))[0]
  const stock = async () =>
    (await db.select().from(productVariants).where(eq(productVariants.id, sling.variantId)))[0]?.stockQty ?? 0

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    fixtures = proFixtures(app, TAG)
    await fixtures.cleanup()
    pro = await fixtures.account({ organisation: "approved" })
    admin = await fixtures.account({ role: "admin" })
    sling = await fixtures.product("sling", { categorySlug: "accessoire-tireur", priceHt: 20 })
  })

  beforeEach(() => {
    vi.mocked(sendUnpaidOrderCancelledEmail).mockClear()
    vi.mocked(sendInvoiceDueReminderEmail).mockClear()
  })

  afterAll(async () => {
    const orderIds = db.select({ id: orders.id }).from(orders).where(eq(orders.userId, pro.id))
    await db.delete(auditLogs).where(inArray(auditLogs.orderId, orderIds))
    await db.delete(paymentCarte).where(inArray(paymentCarte.orderId, orderIds))
    await db.delete(paymentVirement).where(inArray(paymentVirement.orderId, orderIds))
    await db.delete(orders).where(eq(orders.userId, pro.id))
    await fixtures.cleanup()
    await app.close()
  })

  describe("paid at once", () => {
    it("gives a pro a week to pay, whatever the means — not the shop's hour", async () => {
      const { orderId } = await quoteOrder({ placedDaysAgo: 2 })

      await sweepUnpaidOrders()

      expect((await orderOf(orderId))?.paymentStatus).toBe("pending")
    })

    it("cancels it after a week, gives the stock back and opens the quote again", async () => {
      const { orderId, quoteRequestId } = await quoteOrder({ placedDaysAgo: 8 })
      const before = await stock()

      await sweepUnpaidOrders()

      expect((await orderOf(orderId))?.paymentStatus).toBe("cancelled")
      expect(await stock()).toBe(before + 2)
      expect((await requestOf(quoteRequestId))?.status).toBe("sent")
      const events = await db.select().from(auditLogs).where(eq(auditLogs.entityId, quoteRequestId))
      expect(events.map((event) => event.action)).toContain("quote_request.reopened")
      expect(sendUnpaidOrderCancelledEmail).toHaveBeenCalledOnce()
    })

    it("leaves the quote expired when its validity has passed meanwhile", async () => {
      const { quoteRequestId } = await quoteOrder({ placedDaysAgo: 8, quoteValidUntil: daysAgo(1) })

      await sweepUnpaidOrders()

      expect((await requestOf(quoteRequestId))?.status).toBe("expired")
    })
  })

  describe("on invoice", () => {
    it("is never cancelled by the sweep", async () => {
      const { orderId } = await quoteOrder({ placedDaysAgo: 40, net30: true, dueAt: daysAgo(5) })

      await sweepUnpaidOrders()

      expect((await orderOf(orderId))?.paymentStatus).toBe("pending")
    })

    it("reminds the pro five days before the due date, once", async () => {
      const dueAt = new Date(Date.now() + 4 * DAY_MS)
      const { orderId } = await quoteOrder({ placedDaysAgo: 26, net30: true, dueAt })
      const later = await quoteOrder({ placedDaysAgo: 2, net30: true, dueAt: new Date(Date.now() + 28 * DAY_MS) })

      await remindInvoicesDue()
      await remindInvoicesDue()

      const calls = vi.mocked(sendInvoiceDueReminderEmail).mock.calls
      expect(calls.filter(([, reminder]) => reminder.orderId === orderId)).toHaveLength(1)
      expect(calls.find(([, reminder]) => reminder.orderId === orderId)?.[1]).toMatchObject({
        amountTtc: 43.2,
        dueAt,
        reference: expect.stringMatching(/^SCS-QP/),
      })
      expect(calls.some(([, reminder]) => reminder.orderId === later.orderId)).toBe(false)
      expect((await orderOf(orderId))?.paymentReminderSentAt).toBeInstanceOf(Date)
    })

    it("shows as late in the back-office once the due date has passed unpaid", async () => {
      const late = await quoteOrder({ placedDaysAgo: 40, net30: true, dueAt: daysAgo(3) })
      const onTime = await quoteOrder({ placedDaysAgo: 5, net30: true, dueAt: new Date(Date.now() + 25 * DAY_MS) })

      const view = async (id: string) =>
        (
          await app.inject({
            method: "GET",
            url: `/api/admin/orders/${id}`,
            headers: { authorization: `Bearer ${admin.token}` },
          })
        ).json().data

      expect((await view(late.orderId)).paymentLate).toBe(true)
      expect((await view(onTime.orderId)).paymentLate).toBe(false)

      // And among the overdue payments SCS follows up.
      const overdue = (
        await app.inject({
          method: "GET",
          url: "/api/admin/orders?payments=overdue&limit=100",
          headers: { authorization: `Bearer ${admin.token}` },
        })
      )
        .json()
        .data.map((order: { id: string }) => order.id)
      expect(overdue).toContain(late.orderId)
      expect(overdue).not.toContain(onTime.orderId)
    })
  })
})
