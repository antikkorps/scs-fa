import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { and, eq, inArray, like } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { db } from "../db/client.js"
import {
  artworkPrints,
  artworks,
  auditLogs,
  henrriDocuments,
  legalCategories,
  orders,
  paymentCarte,
  paymentVirement,
  productCategories,
  products,
  productVariants,
  users,
} from "../db/schema.js"

vi.mock("../payments/stripe.js", () => ({
  createPaymentIntent: vi.fn(),
  retrievePaymentIntent: vi.fn(),
  cancelPaymentIntent: vi.fn(),
  retrieveCharge: vi.fn(),
  createRefund: vi.fn(),
  constructWebhookEvent: vi.fn(),
}))

vi.mock("../email.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../email.js")>()),
  sendTransferReminderEmail: vi.fn().mockResolvedValue(undefined),
  sendUnpaidOrderCancelledEmail: vi.fn().mockResolvedValue(undefined),
}))

import { sendTransferReminderEmail, sendUnpaidOrderCancelledEmail } from "../email.js"
import { initStripePayment, recomputeOrderPaymentStatus } from "../payments/service.js"
import { cancelPaymentIntent, retrievePaymentIntent } from "../payments/stripe.js"
import { sweepUnpaidOrders } from "./expiry.js"

const PREFIX = "TESTEXP-"
const EMAIL = "expiry-test@expiry-test.local"
const NOW = new Date("2026-10-22T12:00:00Z")
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60 * 1000)
const daysAgo = (days: number) => minutesAgo(days * 24 * 60)

type ItemsJson = (typeof orders.$inferSelect)["itemsJson"]

describe("unpaid order sweep (story 12.9a)", () => {
  let userId: string
  let variantId: string
  let artworkId: string
  let printCounter = 0

  async function cleanup() {
    const userIds = db.select({ id: users.id }).from(users).where(like(users.email, "expiry-test%"))
    const orderIds = db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, userIds))
    await db.delete(auditLogs).where(inArray(auditLogs.orderId, orderIds))
    await db.delete(henrriDocuments).where(inArray(henrriDocuments.orderId, orderIds))
    await db.delete(artworkPrints).where(like(artworkPrints.printDesignation, `${PREFIX}%`))
    await db.delete(artworks).where(like(artworks.sku, `${PREFIX}%`))
    await db.delete(paymentVirement).where(inArray(paymentVirement.orderId, orderIds))
    await db.delete(paymentCarte).where(inArray(paymentCarte.orderId, orderIds))
    await db.delete(orders).where(inArray(orders.userId, userIds))
    await db.delete(productVariants).where(like(productVariants.skuVariant, `${PREFIX}%`))
    await db.delete(products).where(like(products.sku, `${PREFIX}%`))
    await db.delete(users).where(like(users.email, "expiry-test%"))
  }

  async function seededId<T extends { id: string }>(rows: Promise<T[]>, what: string): Promise<string> {
    const [row] = await rows
    if (!row) throw new Error(`Missing seeded ${what}`)
    return row.id
  }

  async function stockOf(id: string): Promise<number> {
    const [row] = await db
      .select({ stockQty: productVariants.stockQty })
      .from(productVariants)
      .where(eq(productVariants.id, id))
    return row.stockQty ?? 0
  }

  async function reservedPrint(): Promise<string> {
    printCounter += 1
    const [print] = await db
      .insert(artworkPrints)
      .values({
        artworkId,
        printNumber: printCounter,
        totalPrints: 25,
        printDesignation: `${PREFIX}${printCounter}/25`,
        formatId: "a4",
        priceHtUnit: "200.00",
        status: "reserved",
      })
      .returning({ id: artworkPrints.id })
    return print.id
  }

  const variantLine = (): ItemsJson[number] => ({
    variantId,
    qty: 1,
    priceHt: 100,
    name: "Tapis de tir",
    sku: `${PREFIX}acc`,
    category: "accessoire-tireur",
    legalCategory: "none",
    requiresPaymentVirement: false,
  })

  async function insertOrder(opts: {
    placedAt: Date
    items?: ItemsJson
    paymentStatus?: "pending" | "received"
    carte?: { status?: "pending" | "received" | "failed"; intentId?: string }
    virement?: { status?: "awaiting_transfer" | "transfer_claimed" | "received" }
  }): Promise<string> {
    const [order] = await db
      .insert(orders)
      .values({
        userId,
        itemsJson: opts.items ?? [variantLine()],
        subtotalHt: "100.00",
        vatAmount: "20.00",
        totalTtc: "120.00",
        paymentStatus: opts.paymentStatus ?? "pending",
        createdAt: opts.placedAt,
      })
      .returning({ id: orders.id })
    if (opts.carte) {
      await db.insert(paymentCarte).values({
        orderId: order.id,
        amountTtc: "120.00",
        paymentStatus: opts.carte.status ?? "pending",
        stripePaymentIntentId: opts.carte.intentId ?? null,
      })
    }
    if (opts.virement) {
      await db.insert(paymentVirement).values({
        orderId: order.id,
        amountExpectedTtc: "1200.00",
        ibanRecipient: "FR7630006000011234567890189",
        paymentReference: `SCS-EXP-${order.id.slice(0, 8)}`,
        paymentStatus: opts.virement.status ?? "awaiting_transfer",
      })
    }
    return order.id
  }

  async function orderState(orderId: string) {
    const [order] = await db
      .select({ paymentStatus: orders.paymentStatus, reminderSentAt: orders.paymentReminderSentAt })
      .from(orders)
      .where(eq(orders.id, orderId))
    const [carte] = await db
      .select({ status: paymentCarte.paymentStatus })
      .from(paymentCarte)
      .where(eq(paymentCarte.orderId, orderId))
    const [virement] = await db
      .select({ status: paymentVirement.paymentStatus })
      .from(paymentVirement)
      .where(eq(paymentVirement.orderId, orderId))
    return { ...order, carte: carte?.status, virement: virement?.status }
  }

  async function historyEvent(orderId: string, action: string) {
    return db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.orderId, orderId), eq(auditLogs.action, action)))
  }

  beforeAll(async () => {
    await cleanup()
    userId = await seededId(
      db
        .insert(users)
        .values({
          email: EMAIL,
          passwordHash: "not-used",
          role: "customer",
          firstname: "Jean",
          rgpdConsentAt: new Date(),
          rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
        })
        .returning({ id: users.id }),
      "user",
    )
    const categoryId = await seededId(
      db
        .select({ id: productCategories.id })
        .from(productCategories)
        .where(eq(productCategories.slug, "accessoire-tireur")),
      "category",
    )
    const legalCategoryId = await seededId(
      db.select({ id: legalCategories.id }).from(legalCategories).where(eq(legalCategories.category, "none")),
      "legal category",
    )
    const productId = await seededId(
      db
        .insert(products)
        .values({
          sku: `${PREFIX}acc`,
          slug: `${PREFIX}acc`,
          name: "Tapis de tir",
          categoryId,
          legalCategoryId,
          priceHt: "100.00",
          requiresLegalVerification: false,
          published: true,
        })
        .returning({ id: products.id }),
      "product",
    )
    variantId = await seededId(
      db
        .insert(productVariants)
        .values({ productId, skuVariant: `${PREFIX}acc-v1`, couleur: "Vert", stockQty: 10 })
        .returning({ id: productVariants.id }),
      "variant",
    )
    artworkId = await seededId(
      db
        .insert(artworks)
        .values({
          productId,
          slug: `${PREFIX}art`,
          sku: `${PREFIX}art`,
          title: "Oeuvre",
          editionLimit: 25,
          basePriceHt: "200.00",
          priceIncrementHt: "10.00",
        })
        .returning({ id: artworks.id }),
      "artwork",
    )
  })

  afterAll(cleanup)

  beforeEach(async () => {
    // Each case starts with no other unpaid order lying around for the sweep.
    const userOrders = db.select({ id: orders.id }).from(orders).where(eq(orders.userId, userId))
    await db.delete(auditLogs).where(inArray(auditLogs.orderId, userOrders))
    await db.delete(paymentVirement).where(inArray(paymentVirement.orderId, userOrders))
    await db.delete(paymentCarte).where(inArray(paymentCarte.orderId, userOrders))
    await db
      .update(artworkPrints)
      .set({ orderId: null })
      .where(like(artworkPrints.printDesignation, `${PREFIX}%`))
    await db.delete(orders).where(eq(orders.userId, userId))
    vi.mocked(retrievePaymentIntent).mockReset()
    vi.mocked(cancelPaymentIntent).mockReset()
    vi.mocked(sendTransferReminderEmail).mockClear()
    vi.mocked(sendUnpaidOrderCancelledEmail).mockClear()
  })

  describe("card-only orders", () => {
    it("cancels an order left unpaid for over an hour and puts its stock back", async () => {
      const stockBefore = await stockOf(variantId)
      const orderId = await insertOrder({ placedAt: minutesAgo(61), carte: {} })

      const result = await sweepUnpaidOrders(NOW)

      expect(result.cancelled).toBe(1)
      expect(await orderState(orderId)).toMatchObject({ paymentStatus: "cancelled", carte: "cancelled" })
      expect(await stockOf(variantId)).toBe(stockBefore + 1)
      expect(await historyEvent(orderId, "order.expired")).toHaveLength(1)
      expect(sendUnpaidOrderCancelledEmail).toHaveBeenCalledWith(
        EMAIL,
        expect.objectContaining({ orderId, firstname: "Jean" }),
      )
    })

    it("leaves an order still within its hour alone", async () => {
      const orderId = await insertOrder({ placedAt: minutesAgo(59), carte: {} })

      await sweepUnpaidOrders(NOW)

      expect(await orderState(orderId)).toMatchObject({ paymentStatus: "pending", carte: "pending" })
    })

    it("cancels a card payment the customer gave up on, so it can no longer be paid", async () => {
      const orderId = await insertOrder({ placedAt: minutesAgo(90), carte: { intentId: "pi_abandoned" } })
      vi.mocked(retrievePaymentIntent).mockResolvedValue({
        id: "pi_abandoned",
        status: "requires_payment_method",
      } as never)
      vi.mocked(cancelPaymentIntent).mockResolvedValue({ id: "pi_abandoned", status: "canceled" } as never)

      await sweepUnpaidOrders(NOW)

      expect(cancelPaymentIntent).toHaveBeenCalledWith("pi_abandoned")
      expect((await orderState(orderId)).paymentStatus).toBe("cancelled")
    })

    it("waits for Stripe when the card payment is still being processed", async () => {
      const orderId = await insertOrder({ placedAt: minutesAgo(90), carte: { intentId: "pi_processing" } })
      vi.mocked(retrievePaymentIntent).mockResolvedValue({ id: "pi_processing", status: "processing" } as never)

      const result = await sweepUnpaidOrders(NOW)

      expect(cancelPaymentIntent).not.toHaveBeenCalled()
      expect(result.cancelled).toBe(0)
      expect((await orderState(orderId)).paymentStatus).toBe("pending")
    })

    it("keeps the order when Stripe refuses the cancellation (the payment just went through)", async () => {
      const orderId = await insertOrder({ placedAt: minutesAgo(90), carte: { intentId: "pi_race" } })
      vi.mocked(retrievePaymentIntent).mockResolvedValue({ id: "pi_race", status: "requires_action" } as never)
      vi.mocked(cancelPaymentIntent).mockRejectedValue(new Error("payment_intent_unexpected_state"))

      const result = await sweepUnpaidOrders(NOW)

      expect(result.cancelled).toBe(0)
      expect((await orderState(orderId)).paymentStatus).toBe("pending")
    })

    it("releases the Gun Art prints the order had reserved", async () => {
      const printId = await reservedPrint()
      const orderId = await insertOrder({
        placedAt: minutesAgo(61),
        carte: {},
        items: [
          {
            printId,
            qty: 1,
            priceHt: 200,
            name: "Oeuvre",
            sku: `${PREFIX}art`,
            category: "gun-art",
            requiresPaymentVirement: false,
          },
        ],
      })
      await db.update(artworkPrints).set({ orderId }).where(eq(artworkPrints.id, printId))

      await sweepUnpaidOrders(NOW)

      const [print] = await db
        .select({ status: artworkPrints.status, orderId: artworkPrints.orderId })
        .from(artworkPrints)
        .where(eq(artworkPrints.id, printId))
      expect(print).toEqual({ status: "available", orderId: null })
    })

    it("cancels a given order once, however many sweeps run", async () => {
      const stockBefore = await stockOf(variantId)
      await insertOrder({ placedAt: minutesAgo(61), carte: {} })

      await Promise.all([sweepUnpaidOrders(NOW), sweepUnpaidOrders(NOW)])
      await sweepUnpaidOrders(NOW)

      expect(await stockOf(variantId)).toBe(stockBefore + 1)
      expect(sendUnpaidOrderCancelledEmail).toHaveBeenCalledTimes(1)
    })

    it("never touches a paid order", async () => {
      const stockBefore = await stockOf(variantId)
      const orderId = await insertOrder({
        placedAt: daysAgo(30),
        paymentStatus: "received",
        carte: { status: "received" },
      })

      await sweepUnpaidOrders(NOW)

      expect((await orderState(orderId)).paymentStatus).toBe("received")
      expect(await stockOf(variantId)).toBe(stockBefore)
    })
  })

  describe("orders with a bank transfer", () => {
    it("reminds the customer once, from day 4", async () => {
      const orderId = await insertOrder({ placedAt: daysAgo(4.5), virement: {} })

      const first = await sweepUnpaidOrders(NOW)
      await sweepUnpaidOrders(NOW)

      expect(first.reminded).toBe(1)
      expect(sendTransferReminderEmail).toHaveBeenCalledTimes(1)
      expect(sendTransferReminderEmail).toHaveBeenCalledWith(EMAIL, expect.objectContaining({ orderId }))
      const state = await orderState(orderId)
      expect(state.paymentStatus).toBe("pending")
      expect(state.reminderSentAt).not.toBeNull()
    })

    it("neither reminds nor cancels before day 4", async () => {
      const orderId = await insertOrder({ placedAt: daysAgo(3), virement: {} })

      await sweepUnpaidOrders(NOW)

      expect(sendTransferReminderEmail).not.toHaveBeenCalled()
      expect((await orderState(orderId)).paymentStatus).toBe("pending")
    })

    it("does not remind a customer who has said the transfer is on its way", async () => {
      await insertOrder({ placedAt: daysAgo(5), virement: { status: "transfer_claimed" } })

      await sweepUnpaidOrders(NOW)

      expect(sendTransferReminderEmail).not.toHaveBeenCalled()
    })

    it("cancels after seven days without the transfer, card part included", async () => {
      const orderId = await insertOrder({ placedAt: daysAgo(7.1), carte: {}, virement: {} })

      await sweepUnpaidOrders(NOW)

      expect(await orderState(orderId)).toMatchObject({
        paymentStatus: "cancelled",
        carte: "cancelled",
        virement: "cancelled",
      })
    })

    it("gives the card part of a mixed order the transfer's week, not an hour", async () => {
      const orderId = await insertOrder({ placedAt: daysAgo(2), carte: {}, virement: {} })

      await sweepUnpaidOrders(NOW)

      expect((await orderState(orderId)).paymentStatus).toBe("pending")
    })

    it("leaves a declared transfer to SCS, even overdue", async () => {
      const orderId = await insertOrder({ placedAt: daysAgo(10), virement: { status: "transfer_claimed" } })

      await sweepUnpaidOrders(NOW)

      expect((await orderState(orderId)).paymentStatus).toBe("pending")
    })

    it("leaves a partly paid order to SCS, even overdue", async () => {
      const orderId = await insertOrder({
        placedAt: daysAgo(10),
        carte: { status: "received" },
        virement: {},
      })

      await sweepUnpaidOrders(NOW)

      expect(await orderState(orderId)).toMatchObject({ paymentStatus: "pending", carte: "received" })
    })
  })

  describe("money arriving on a cancelled order", () => {
    it("refuses to open a card payment on it", async () => {
      const orderId = await insertOrder({ placedAt: minutesAgo(61), carte: {} })
      await sweepUnpaidOrders(NOW)

      await expect(initStripePayment(orderId, userId)).rejects.toMatchObject({
        statusCode: 409,
        errorCode: "OrderCancelled",
      })
    })

    it("does not revive the order, and says so in its history", async () => {
      const orderId = await insertOrder({ placedAt: daysAgo(8), virement: {} })
      await sweepUnpaidOrders(NOW)
      await db.update(paymentVirement).set({ paymentStatus: "received" }).where(eq(paymentVirement.orderId, orderId))

      await recomputeOrderPaymentStatus(orderId)

      expect((await orderState(orderId)).paymentStatus).toBe("cancelled")
      const [event] = await historyEvent(orderId, "payment.received_after_cancellation")
      expect(event).toMatchObject({ result: "failure" })
    })
  })
})
