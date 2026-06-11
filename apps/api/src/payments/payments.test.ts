import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import {
  addresses,
  auditLogs,
  cartItems,
  legalCategories,
  orders,
  paymentCarte,
  productCategories,
  products,
  productVariants,
  users,
} from "../db/schema.js"

// Stripe is mocked wholesale: no network, no keys. The service and webhook
// route both import from "./stripe.js", so they share these mocks.
vi.mock("./stripe.js", () => ({
  createPaymentIntent: vi.fn(),
  retrievePaymentIntent: vi.fn(),
  constructWebhookEvent: vi.fn(),
}))

import { constructWebhookEvent, createPaymentIntent, retrievePaymentIntent } from "./stripe.js"

const PREFIX = "TESTPAY-"
const PASSWORD = "MotDePasseTresLong123!"
const EMAIL = "pay-test61@pay-test.local"
const EMAIL_OTHER = "pay-test61-other@pay-test.local"

type ItemsJson = (typeof orders.$inferInsert)["itemsJson"]

const CARD_ITEM = {
  qty: 1,
  priceHt: 100,
  name: "Tapis de tir",
  sku: `${PREFIX}acc`,
  category: "accessoire-tireur",
  legalCategory: "none",
  requiresPaymentVirement: false,
}
const FIREARM_ITEM = {
  qty: 1,
  priceHt: 1000,
  name: "Carabine",
  sku: `${PREFIX}reg`,
  category: "arme-longue",
  legalCategory: "B",
  requiresPaymentVirement: true,
}

describe("payments — Stripe card (Story 6.1)", () => {
  let app: FastifyInstance
  let userId: string
  let token: string
  let otherToken: string
  let shippingAddressId: string
  let accessoryVariantId: string

  async function cleanup() {
    const userIds = db.select({ id: users.id }).from(users).where(like(users.email, "pay-test61%"))
    const orderIds = db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, userIds))
    const carteIds = db
      .select({ id: paymentCarte.id })
      .from(paymentCarte)
      .where(inArray(paymentCarte.orderId, orderIds))
    const variantIds = db
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(like(productVariants.skuVariant, `${PREFIX}%`))

    await db.delete(auditLogs).where(inArray(auditLogs.entityId, carteIds))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
    await db.delete(paymentCarte).where(inArray(paymentCarte.orderId, orderIds))
    await db.delete(cartItems).where(inArray(cartItems.variantId, variantIds))
    await db.delete(orders).where(inArray(orders.userId, userIds))
    await db.delete(addresses).where(inArray(addresses.userId, userIds))
    await db.delete(productVariants).where(like(productVariants.skuVariant, `${PREFIX}%`))
    await db.delete(products).where(like(products.sku, `${PREFIX}%`))
    await db.delete(users).where(like(users.email, "pay-test61%"))
  }

  async function categoryId(slug: string): Promise<string> {
    const [row] = await db
      .select({ id: productCategories.id })
      .from(productCategories)
      .where(eq(productCategories.slug, slug))
      .limit(1)
    if (!row) throw new Error(`Missing seeded category: ${slug}`)
    return row.id
  }
  async function legalNoneId(): Promise<string> {
    const [row] = await db
      .select({ id: legalCategories.id })
      .from(legalCategories)
      .where(eq(legalCategories.category, "none"))
      .limit(1)
    if (!row) throw new Error("Missing seeded legal category: none")
    return row.id
  }

  async function insertOrder(owner: string, items: ItemsJson, paymentStatus: "pending" | "received" = "pending") {
    const [o] = await db
      .insert(orders)
      .values({
        userId: owner,
        itemsJson: items,
        subtotalHt: "100.00",
        vatAmount: "20.00",
        totalTtc: "120.00",
        paymentStatus,
      })
      .returning({ id: orders.id })
    return o.id
  }

  async function insertCarte(
    orderId: string,
    opts: { amountTtc?: string; status?: "pending" | "received"; intentId?: string } = {},
  ) {
    const [c] = await db
      .insert(paymentCarte)
      .values({
        orderId,
        amountTtc: opts.amountTtc ?? "120.00",
        currency: "EUR",
        paymentStatus: opts.status ?? "pending",
        stripePaymentIntentId: opts.intentId ?? null,
      })
      .returning({ id: paymentCarte.id })
    return c.id
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()

    const passwordHash = await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
    const [u1] = await db
      .insert(users)
      .values({
        email: EMAIL,
        passwordHash,
        role: "customer",
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id })
    userId = u1.id
    await db.insert(users).values({
      email: EMAIL_OTHER,
      passwordHash,
      role: "customer",
      rgpdConsentAt: new Date(),
      rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
    })

    const [addr] = await db
      .insert(addresses)
      .values({
        userId,
        firstName: "Jean",
        lastName: "Tireur",
        line1: "1 rue du Tir",
        postal: "75001",
        city: "Paris",
        isDefault: true,
      })
      .returning({ id: addresses.id })
    shippingAddressId = addr.id

    const [accessory] = await db
      .insert(products)
      .values({
        sku: `${PREFIX}acc`,
        slug: `${PREFIX}acc`,
        name: "Tapis de tir",
        categoryId: await categoryId("accessoire-tireur"),
        legalCategoryId: await legalNoneId(),
        priceHt: "50.00",
        requiresLegalVerification: false,
        published: true,
      })
      .returning({ id: products.id })
    const [accVariant] = await db
      .insert(productVariants)
      .values({ productId: accessory.id, skuVariant: `${PREFIX}acc-v1`, couleur: "Vert", stockQty: 5 })
      .returning({ id: productVariants.id })
    accessoryVariantId = accVariant.id

    const loginAs = async (email: string) =>
      (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } })).json()
        .accessToken
    token = await loginAs(EMAIL)
    otherToken = await loginAs(EMAIL_OTHER)
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  beforeEach(() => {
    vi.mocked(createPaymentIntent).mockReset()
    vi.mocked(retrievePaymentIntent).mockReset()
    vi.mocked(constructWebhookEvent).mockReset()
  })

  describe("order creation persists the card bucket", () => {
    it("creates a payment_carte row matching the card split", async () => {
      await db.insert(cartItems).values({ userId, variantId: accessoryVariantId, qty: 1, priceHtAtTime: "50.00" })

      const res = await app.inject({
        method: "POST",
        url: "/api/orders",
        headers: { authorization: `Bearer ${token}` },
        payload: { shippingAddressId },
      })
      expect(res.statusCode).toBe(201)
      const { data } = res.json()
      expect(data.paymentSplit.splitType).toBe("carte_only")

      const [carte] = await db.select().from(paymentCarte).where(eq(paymentCarte.orderId, data.id))
      expect(carte).toBeTruthy()
      expect(Number(carte.amountTtc)).toBeCloseTo(data.paymentSplit.carte.amountTtc, 2)
      expect(carte.paymentStatus).toBe("pending")
    })
  })

  describe("POST /api/payments/stripe/intent", () => {
    it("creates a PaymentIntent and stores its id (201)", async () => {
      const orderId = await insertOrder(userId, [CARD_ITEM])
      await insertCarte(orderId, { amountTtc: "120.00" })
      vi.mocked(createPaymentIntent).mockResolvedValue({
        id: "pi_new_1",
        client_secret: "pi_new_1_secret",
        status: "requires_payment_method",
      } as never)

      const res = await app.inject({
        method: "POST",
        url: "/api/payments/stripe/intent",
        headers: { authorization: `Bearer ${token}` },
        payload: { orderId },
      })

      expect(res.statusCode).toBe(201)
      expect(res.json().data).toMatchObject({
        clientSecret: "pi_new_1_secret",
        paymentIntentId: "pi_new_1",
        amountTtc: "120.00",
        reused: false,
      })
      // amount is sent to Stripe in cents
      expect(vi.mocked(createPaymentIntent).mock.calls[0][0].amount).toBe(12_000)

      const [carte] = await db.select().from(paymentCarte).where(eq(paymentCarte.orderId, orderId))
      expect(carte.stripePaymentIntentId).toBe("pi_new_1")
    })

    it("reuses an existing pending intent instead of creating a duplicate", async () => {
      const orderId = await insertOrder(userId, [CARD_ITEM])
      await insertCarte(orderId, { amountTtc: "120.00", intentId: "pi_existing" })
      vi.mocked(retrievePaymentIntent).mockResolvedValue({
        id: "pi_existing",
        client_secret: "pi_existing_secret",
        status: "requires_payment_method",
      } as never)

      const res = await app.inject({
        method: "POST",
        url: "/api/payments/stripe/intent",
        headers: { authorization: `Bearer ${token}` },
        payload: { orderId },
      })

      expect(res.statusCode).toBe(201)
      expect(res.json().data).toMatchObject({ paymentIntentId: "pi_existing", reused: true })
      expect(vi.mocked(createPaymentIntent)).not.toHaveBeenCalled()
    })

    it("returns 404 for an order owned by someone else", async () => {
      const orderId = await insertOrder(userId, [CARD_ITEM])
      await insertCarte(orderId)

      const res = await app.inject({
        method: "POST",
        url: "/api/payments/stripe/intent",
        headers: { authorization: `Bearer ${otherToken}` },
        payload: { orderId },
      })
      expect(res.statusCode).toBe(404)
    })

    it("returns 400 when the order has no card-payable amount (virement only)", async () => {
      const orderId = await insertOrder(userId, [FIREARM_ITEM])
      // no payment_carte row for a virement-only order

      const res = await app.inject({
        method: "POST",
        url: "/api/payments/stripe/intent",
        headers: { authorization: `Bearer ${token}` },
        payload: { orderId },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe("NoCardPayment")
    })

    it("returns 409 when the card payment is already settled", async () => {
      const orderId = await insertOrder(userId, [CARD_ITEM], "received")
      await insertCarte(orderId, { status: "received" })

      const res = await app.inject({
        method: "POST",
        url: "/api/payments/stripe/intent",
        headers: { authorization: `Bearer ${token}` },
        payload: { orderId },
      })
      expect(res.statusCode).toBe(409)
      expect(res.json().error).toBe("AlreadyPaid")
    })

    it("returns 401 without a token", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/payments/stripe/intent",
        payload: { orderId: "00000000-0000-0000-0000-000000000000" },
      })
      expect(res.statusCode).toBe(401)
    })
  })

  describe("POST /api/webhooks/stripe", () => {
    function post(event: unknown) {
      vi.mocked(constructWebhookEvent).mockReturnValue(event as never)
      return app.inject({
        method: "POST",
        url: "/api/webhooks/stripe",
        headers: { "stripe-signature": "t=1,v1=sig", "content-type": "application/json" },
        payload: JSON.stringify(event),
      })
    }

    it("payment_intent.succeeded settles a card-only order to received", async () => {
      const orderId = await insertOrder(userId, [CARD_ITEM])
      await insertCarte(orderId, { intentId: "pi_ok_1" })

      const res = await post({
        type: "payment_intent.succeeded",
        data: {
          object: {
            id: "pi_ok_1",
            charges: { data: [{ payment_method_details: { card: { last4: "4242", brand: "visa" } } }] },
          },
        },
      })

      expect(res.statusCode).toBe(200)
      const [carte] = await db.select().from(paymentCarte).where(eq(paymentCarte.orderId, orderId))
      expect(carte.paymentStatus).toBe("received")
      expect(carte.last4).toBe("4242")
      expect(carte.brand).toBe("visa")
      expect(carte.processedAt).not.toBeNull()
      const [order] = await db.select().from(orders).where(eq(orders.id, orderId))
      expect(order.paymentStatus).toBe("received")
    })

    it("does not flip a mixed order to received while the transfer is still due", async () => {
      const orderId = await insertOrder(userId, [CARD_ITEM, FIREARM_ITEM])
      await insertCarte(orderId, { intentId: "pi_mixed_1" })

      const res = await post({
        type: "payment_intent.succeeded",
        data: { object: { id: "pi_mixed_1" } },
      })

      expect(res.statusCode).toBe(200)
      const [carte] = await db.select().from(paymentCarte).where(eq(paymentCarte.orderId, orderId))
      expect(carte.paymentStatus).toBe("received")
      const [order] = await db.select().from(orders).where(eq(orders.id, orderId))
      expect(order.paymentStatus).toBe("pending") // virement bucket not settled yet (Story 6.2)
    })

    it("payment_intent.payment_failed marks the card failed, order stays pending", async () => {
      const orderId = await insertOrder(userId, [CARD_ITEM])
      await insertCarte(orderId, { intentId: "pi_fail_1" })

      const res = await post({
        type: "payment_intent.payment_failed",
        data: { object: { id: "pi_fail_1", last_payment_error: { message: "card_declined" } } },
      })

      expect(res.statusCode).toBe(200)
      const [carte] = await db.select().from(paymentCarte).where(eq(paymentCarte.orderId, orderId))
      expect(carte.paymentStatus).toBe("failed")
      expect(carte.failureReason).toBe("card_declined")
      const [order] = await db.select().from(orders).where(eq(orders.id, orderId))
      expect(order.paymentStatus).toBe("pending")
    })

    it("ignores an event for an unknown PaymentIntent (200, no-op)", async () => {
      const res = await post({ type: "payment_intent.succeeded", data: { object: { id: "pi_unknown" } } })
      expect(res.statusCode).toBe(200)
    })

    it("rejects a bad signature with 400", async () => {
      vi.mocked(constructWebhookEvent).mockImplementation(() => {
        throw new Error("bad signature")
      })
      const res = await app.inject({
        method: "POST",
        url: "/api/webhooks/stripe",
        headers: { "stripe-signature": "bad", "content-type": "application/json" },
        payload: "{}",
      })
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe("InvalidSignature")
    })

    it("rejects a missing signature header with 400", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/webhooks/stripe",
        headers: { "content-type": "application/json" },
        payload: "{}",
      })
      expect(res.statusCode).toBe(400)
    })
  })
})
