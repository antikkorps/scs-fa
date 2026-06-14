import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import {
  addresses,
  artworkPrints,
  artworks,
  auditLogs,
  cartItems,
  legalCategories,
  orders,
  paymentCarte,
  paymentVirement,
  productCategories,
  products,
  productVariants,
  refunds,
  users,
} from "../db/schema.js"

// Stripe is mocked wholesale: no network, no keys. The service and webhook
// route both import from "./stripe.js", so they share these mocks.
vi.mock("./stripe.js", () => ({
  createPaymentIntent: vi.fn(),
  retrievePaymentIntent: vi.fn(),
  createRefund: vi.fn(),
  constructWebhookEvent: vi.fn(),
}))

import { recomputeVipStatus } from "../vip/service.js"
import { constructWebhookEvent, createPaymentIntent, createRefund, retrievePaymentIntent } from "./stripe.js"

const PREFIX = "TESTPAY-"
const PASSWORD = "MotDePasseTresLong123!"
const EMAIL = "pay-test61@pay-test.local"
const EMAIL_OTHER = "pay-test61-other@pay-test.local"
const EMAIL_ADMIN = "pay-test61-admin@pay-test.local"

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
  let adminId: string
  let adminToken: string
  let shippingAddressId: string
  let accessoryVariantId: string
  let regulatedVariantId: string

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
    await db.delete(refunds).where(inArray(refunds.orderId, orderIds))
    // Prints still attached to a test order must be released before the order is
    // deleted (orderId FK has no cascade); released/seeded prints go with the
    // product cascade below.
    await db.delete(artworkPrints).where(inArray(artworkPrints.orderId, orderIds))
    await db.delete(artworkPrints).where(like(artworkPrints.printDesignation, `${PREFIX}%`))
    await db.delete(artworks).where(like(artworks.sku, `${PREFIX}%`))
    await db.delete(paymentVirement).where(inArray(paymentVirement.orderId, orderIds))
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
  async function legalCategoryId(code: "B" | "none"): Promise<string> {
    const [row] = await db
      .select({ id: legalCategories.id })
      .from(legalCategories)
      .where(eq(legalCategories.category, code))
      .limit(1)
    if (!row) throw new Error(`Missing seeded legal category: ${code}`)
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

  async function insertVirement(
    orderId: string,
    opts: {
      amountTtc?: string
      reference?: string
      status?: "awaiting_transfer" | "transfer_claimed" | "received" | "reconciled"
    } = {},
  ) {
    const [v] = await db
      .insert(paymentVirement)
      .values({
        orderId,
        amountExpectedTtc: opts.amountTtc ?? "1200.00",
        currency: "EUR",
        ibanRecipient: "FR7630006000011234567890189",
        bicRecipient: "AGRIFRPP",
        bankName: "Banque Test",
        accountHolderName: "SCS Firearm SAS",
        paymentReference: opts.reference ?? `SCS-TEST-${orderId.slice(0, 4)}`,
        paymentStatus: opts.status ?? "awaiting_transfer",
      })
      .returning({ id: paymentVirement.id })
    return v.id
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
    const [admin] = await db
      .insert(users)
      .values({
        email: EMAIL_ADMIN,
        passwordHash,
        role: "admin",
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id })
    adminId = admin.id

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
        legalCategoryId: await legalCategoryId("none"),
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

    const [firearm] = await db
      .insert(products)
      .values({
        sku: `${PREFIX}reg`,
        slug: `${PREFIX}reg`,
        name: "Carabine",
        categoryId: await categoryId("arme-longue"),
        legalCategoryId: await legalCategoryId("B"),
        priceHt: "1000.00",
        requiresLegalVerification: true,
        published: true,
      })
      .returning({ id: products.id })
    const [regVariant] = await db
      .insert(productVariants)
      .values({ productId: firearm.id, skuVariant: `${PREFIX}reg-v1`, couleur: "Noir", stockQty: 5 })
      .returning({ id: productVariants.id })
    regulatedVariantId = regVariant.id

    const loginAs = async (email: string) =>
      (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } })).json()
        .accessToken
    token = await loginAs(EMAIL)
    otherToken = await loginAs(EMAIL_OTHER)
    adminToken = await loginAs(EMAIL_ADMIN)
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  beforeEach(() => {
    vi.mocked(createPaymentIntent).mockReset()
    vi.mocked(retrievePaymentIntent).mockReset()
    vi.mocked(createRefund).mockReset()
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

  describe("bank transfer / virement (Story 6.2)", () => {
    describe("order creation persists the virement bucket", () => {
      it("creates a payment_virement row with a unique reference and snapshotted RIB", async () => {
        await db.insert(cartItems).values({ userId, variantId: regulatedVariantId, qty: 1, priceHtAtTime: "1000.00" })

        const res = await app.inject({
          method: "POST",
          url: "/api/orders",
          headers: { authorization: `Bearer ${token}` },
          payload: { shippingAddressId },
        })
        expect(res.statusCode).toBe(201)
        const { data } = res.json()
        expect(data.paymentSplit.splitType).toBe("virement_only")

        const [virement] = await db.select().from(paymentVirement).where(eq(paymentVirement.orderId, data.id))
        expect(virement).toBeTruthy()
        expect(Number(virement.amountExpectedTtc)).toBeCloseTo(data.paymentSplit.virement.amountTtc, 2)
        expect(virement.paymentStatus).toBe("awaiting_transfer")
        // RIB is snapshotted from env onto the row
        expect(virement.ibanRecipient).toBe("FR7630006000011234567890189")
        expect(virement.bicRecipient).toBe("AGRIFRPP")
        expect(virement.bankName).toBe("Banque Test")
        expect(virement.accountHolderName).toBe("SCS Firearm SAS")
        // unique, typo-resistant reference
        expect(virement.paymentReference).toMatch(/^SCS-[0-9A-Z]{4}-[0-9A-Z]{4}$/)
        expect(virement.paymentReference).not.toMatch(/[ILOU]/)

        // no card bucket for a virement-only order
        const carteRows = await db.select().from(paymentCarte).where(eq(paymentCarte.orderId, data.id))
        expect(carteRows).toHaveLength(0)
      })

      it("creates both buckets for a mixed order, with distinct references per order", async () => {
        await db.insert(cartItems).values([
          { userId, variantId: regulatedVariantId, qty: 1, priceHtAtTime: "1000.00" },
          { userId, variantId: accessoryVariantId, qty: 1, priceHtAtTime: "50.00" },
        ])

        const firstRes = await app.inject({
          method: "POST",
          url: "/api/orders",
          headers: { authorization: `Bearer ${token}` },
          payload: { shippingAddressId },
        })
        expect(firstRes.statusCode).toBe(201)
        const first = firstRes.json().data
        expect(first.paymentSplit.splitType).toBe("mixed")

        const [carte] = await db.select().from(paymentCarte).where(eq(paymentCarte.orderId, first.id))
        const [virement] = await db.select().from(paymentVirement).where(eq(paymentVirement.orderId, first.id))
        expect(carte).toBeTruthy()
        expect(virement).toBeTruthy()
        expect(Number(carte.amountTtc)).toBeCloseTo(first.paymentSplit.carte.amountTtc, 2)
        expect(Number(virement.amountExpectedTtc)).toBeCloseTo(first.paymentSplit.virement.amountTtc, 2)

        // a second virement-only order gets a different reference
        await db.insert(cartItems).values({ userId, variantId: regulatedVariantId, qty: 1, priceHtAtTime: "1000.00" })
        const secondRes = await app.inject({
          method: "POST",
          url: "/api/orders",
          headers: { authorization: `Bearer ${token}` },
          payload: { shippingAddressId },
        })
        const second = secondRes.json().data
        const [v2] = await db.select().from(paymentVirement).where(eq(paymentVirement.orderId, second.id))
        expect(v2.paymentReference).not.toBe(virement.paymentReference)
      })
    })

    describe("GET /api/payments/virement/:id", () => {
      it("returns the RIB instructions for an order the caller owns (200)", async () => {
        const orderId = await insertOrder(userId, [FIREARM_ITEM])
        await insertVirement(orderId, { amountTtc: "1200.00", reference: "SCS-AB12-CD34" })

        const res = await app.inject({
          method: "GET",
          url: `/api/payments/virement/${orderId}`,
          headers: { authorization: `Bearer ${token}` },
        })

        expect(res.statusCode).toBe(200)
        expect(res.json().data).toMatchObject({
          reference: "SCS-AB12-CD34",
          amountTtc: "1200.00",
          currency: "EUR",
          iban: "FR7630006000011234567890189",
          bic: "AGRIFRPP",
          bankName: "Banque Test",
          accountHolder: "SCS Firearm SAS",
          paymentStatus: "awaiting_transfer",
        })
      })

      it("returns 404 for an order owned by someone else", async () => {
        const orderId = await insertOrder(userId, [FIREARM_ITEM])
        await insertVirement(orderId)

        const res = await app.inject({
          method: "GET",
          url: `/api/payments/virement/${orderId}`,
          headers: { authorization: `Bearer ${otherToken}` },
        })
        expect(res.statusCode).toBe(404)
      })

      it("returns 404 for an unknown order id", async () => {
        const res = await app.inject({
          method: "GET",
          url: "/api/payments/virement/00000000-0000-0000-0000-000000000000",
          headers: { authorization: `Bearer ${token}` },
        })
        expect(res.statusCode).toBe(404)
      })

      it("returns 400 when the order has no bank-transfer amount (card only)", async () => {
        const orderId = await insertOrder(userId, [CARD_ITEM])
        await insertCarte(orderId)

        const res = await app.inject({
          method: "GET",
          url: `/api/payments/virement/${orderId}`,
          headers: { authorization: `Bearer ${token}` },
        })
        expect(res.statusCode).toBe(400)
        expect(res.json().error).toBe("NoBankTransfer")
      })

      it("returns 400 for a malformed order id", async () => {
        const res = await app.inject({
          method: "GET",
          url: "/api/payments/virement/not-a-uuid",
          headers: { authorization: `Bearer ${token}` },
        })
        expect(res.statusCode).toBe(400)
      })

      it("returns 401 without a token", async () => {
        const res = await app.inject({
          method: "GET",
          url: "/api/payments/virement/00000000-0000-0000-0000-000000000000",
        })
        expect(res.statusCode).toBe(401)
      })
    })
  })

  describe("reconciliation (Story 6.3)", () => {
    const adminAuth = (token = adminToken) => ({ authorization: `Bearer ${token}` })

    async function freshVirementOrder(reference: string, amountTtc = "1200.00") {
      const orderId = await insertOrder(userId, [FIREARM_ITEM])
      const virementId = await insertVirement(orderId, { amountTtc, reference })
      return { orderId, virementId }
    }

    describe("POST /api/payments/virement/:id/claim (customer)", () => {
      it("flips the bucket to transfer_claimed and stores the declaration (200)", async () => {
        const { orderId, virementId } = await freshVirementOrder("SCS-CLA1-0001")

        const res = await app.inject({
          method: "POST",
          url: `/api/payments/virement/${orderId}/claim`,
          headers: adminAuth(token),
          payload: { reportedIban: "FR7630006000011234567890189", reportedDate: "2026-06-12", reportedAmount: 1200 },
        })

        expect(res.statusCode).toBe(200)
        expect(res.json().data).toMatchObject({ reference: "SCS-CLA1-0001", paymentStatus: "transfer_claimed" })
        const [row] = await db.select().from(paymentVirement).where(eq(paymentVirement.id, virementId))
        expect(row.paymentStatus).toBe("transfer_claimed")
        expect(row.clientReportedIban).toBe("FR7630006000011234567890189")
        expect(Number(row.clientReportedAmount)).toBeCloseTo(1200, 2)
        expect(row.clientReportedRef).toBe("SCS-CLA1-0001")
      })

      it("accepts an empty body (declaration without details)", async () => {
        const { orderId } = await freshVirementOrder("SCS-CLA2-0002")
        const res = await app.inject({
          method: "POST",
          url: `/api/payments/virement/${orderId}/claim`,
          headers: adminAuth(token),
          payload: {},
        })
        expect(res.statusCode).toBe(200)
        expect(res.json().data.paymentStatus).toBe("transfer_claimed")
      })

      it("returns 404 for an order owned by someone else (no leak)", async () => {
        const { orderId } = await freshVirementOrder("SCS-CLA3-0003")
        const res = await app.inject({
          method: "POST",
          url: `/api/payments/virement/${orderId}/claim`,
          headers: adminAuth(otherToken),
          payload: {},
        })
        expect(res.statusCode).toBe(404)
      })

      it("returns 409 when the transfer is already reconciled", async () => {
        const orderId = await insertOrder(userId, [FIREARM_ITEM])
        await insertVirement(orderId, { reference: "SCS-CLA4-0004", status: "reconciled" })
        const res = await app.inject({
          method: "POST",
          url: `/api/payments/virement/${orderId}/claim`,
          headers: adminAuth(token),
          payload: {},
        })
        expect(res.statusCode).toBe(409)
        expect(res.json().error).toBe("AlreadyReconciled")
      })

      it("returns 400 for a card-only order", async () => {
        const orderId = await insertOrder(userId, [CARD_ITEM])
        await insertCarte(orderId)
        const res = await app.inject({
          method: "POST",
          url: `/api/payments/virement/${orderId}/claim`,
          headers: adminAuth(token),
          payload: {},
        })
        expect(res.statusCode).toBe(400)
        expect(res.json().error).toBe("NoBankTransfer")
      })

      it("returns 401 without a token", async () => {
        const res = await app.inject({ method: "POST", url: `/api/payments/virement/${userId}/claim`, payload: {} })
        expect(res.statusCode).toBe(401)
      })
    })

    describe("admin reconciliation routes require the admin role", () => {
      it("rejects a customer on the queue with 403", async () => {
        const res = await app.inject({ method: "GET", url: "/api/admin/payments/virements", headers: adminAuth(token) })
        expect(res.statusCode).toBe(403)
      })

      it("rejects an unauthenticated caller with 401", async () => {
        const res = await app.inject({ method: "GET", url: "/api/admin/payments/virements" })
        expect(res.statusCode).toBe(401)
      })
    })

    describe("GET /api/admin/payments/virements (queue)", () => {
      it("lists outstanding transfers with the order owner and supports the status filter", async () => {
        await freshVirementOrder("SCS-QUE1-0001")

        const res = await app.inject({
          method: "GET",
          url: "/api/admin/payments/virements?status=awaiting_transfer&limit=100",
          headers: adminAuth(),
        })
        expect(res.statusCode).toBe(200)
        const { data, pagination } = res.json()
        expect(pagination).toMatchObject({ page: 1, limit: 100 })
        const mine = data.find((r: { paymentReference: string }) => r.paymentReference === "SCS-QUE1-0001")
        expect(mine).toBeTruthy()
        expect(mine.user.email).toBe(EMAIL)
        expect(mine.paymentStatus).toBe("awaiting_transfer")
      })
    })

    describe("GET /api/admin/payments/virements/:id (detail)", () => {
      it("returns the full reconciliation detail by bucket id (200)", async () => {
        const { virementId } = await freshVirementOrder("SCS-DET1-0001")
        const res = await app.inject({
          method: "GET",
          url: `/api/admin/payments/virements/${virementId}`,
          headers: adminAuth(),
        })
        expect(res.statusCode).toBe(200)
        expect(res.json().data).toMatchObject({ id: virementId, paymentReference: "SCS-DET1-0001" })
      })

      it("returns 404 for an unknown bucket id", async () => {
        const res = await app.inject({
          method: "GET",
          url: "/api/admin/payments/virements/00000000-0000-0000-0000-000000000000",
          headers: adminAuth(),
        })
        expect(res.statusCode).toBe(404)
      })
    })

    describe("POST /api/admin/payments/virements/:id/reconcile (manual)", () => {
      it("settles the bucket, records the receipt and flips the order to received (200)", async () => {
        const { orderId, virementId } = await freshVirementOrder("SCS-REC1-0001")

        const res = await app.inject({
          method: "POST",
          url: `/api/admin/payments/virements/${virementId}/reconcile`,
          headers: adminAuth(),
          payload: { amountReceived: 1200, receivedFromIban: "FR761111", receivedAt: "2026-06-12", notes: "ok" },
        })
        expect(res.statusCode).toBe(200)
        expect(res.json().data).toMatchObject({ paymentStatus: "reconciled", amountMatched: true })

        const [row] = await db.select().from(paymentVirement).where(eq(paymentVirement.id, virementId))
        expect(row.paymentStatus).toBe("reconciled")
        expect(row.reconciledBy).toBe(adminId)
        expect(Number(row.amountReceivedTtc)).toBeCloseTo(1200, 2)
        // virement-only order → settling the bucket settles the order
        const [order] = await db.select().from(orders).where(eq(orders.id, orderId))
        expect(order.paymentStatus).toBe("received")
      })

      it("settles but flags amountMatched=false on an amount mismatch", async () => {
        const { virementId } = await freshVirementOrder("SCS-REC2-0002")
        const res = await app.inject({
          method: "POST",
          url: `/api/admin/payments/virements/${virementId}/reconcile`,
          headers: adminAuth(),
          payload: { amountReceived: 999.99 },
        })
        expect(res.statusCode).toBe(200)
        expect(res.json().data).toMatchObject({ paymentStatus: "reconciled", amountMatched: false })
      })

      it("returns 409 when the bucket is already reconciled", async () => {
        const orderId = await insertOrder(userId, [FIREARM_ITEM])
        const virementId = await insertVirement(orderId, { reference: "SCS-REC3-0003", status: "reconciled" })
        const res = await app.inject({
          method: "POST",
          url: `/api/admin/payments/virements/${virementId}/reconcile`,
          headers: adminAuth(),
          payload: { amountReceived: 1200 },
        })
        expect(res.statusCode).toBe(409)
        expect(res.json().error).toBe("AlreadyReconciled")
      })

      it("returns 404 for an unknown bucket id", async () => {
        const res = await app.inject({
          method: "POST",
          url: "/api/admin/payments/virements/00000000-0000-0000-0000-000000000000/reconcile",
          headers: adminAuth(),
          payload: { amountReceived: 1200 },
        })
        expect(res.statusCode).toBe(404)
      })

      it("returns 400 on an invalid amount", async () => {
        const { virementId } = await freshVirementOrder("SCS-REC4-0004")
        const res = await app.inject({
          method: "POST",
          url: `/api/admin/payments/virements/${virementId}/reconcile`,
          headers: adminAuth(),
          payload: { amountReceived: -5 },
        })
        expect(res.statusCode).toBe(400)
      })
    })

    describe("POST /api/admin/payments/import (CSV)", () => {
      it("auto-reconciles a matching credit and reports the outcome", async () => {
        const { orderId, virementId } = await freshVirementOrder("SCS-CSV1-0001", "1200.00")
        const csv = [
          "Date;Libellé;Montant;IBAN",
          "2026-06-12;VIR SEPA SCS-CSV1-0001 JEAN TIREUR;1 200,00;FR761111",
        ].join("\n")

        const res = await app.inject({
          method: "POST",
          url: "/api/admin/payments/import",
          headers: adminAuth(),
          payload: { csv },
        })
        expect(res.statusCode).toBe(200)
        const { data } = res.json()
        expect(data).toMatchObject({ total: 1, reconciled: 1, needsReview: 0 })
        expect(data.lines[0]).toMatchObject({ outcome: "reconciled", reference: "SCS-CSV1-0001", virementId })

        const [row] = await db.select().from(paymentVirement).where(eq(paymentVirement.id, virementId))
        expect(row.paymentStatus).toBe("reconciled")
        expect(row.receivedFromIban).toBe("FR761111")
        const [order] = await db.select().from(orders).where(eq(orders.id, orderId))
        expect(order.paymentStatus).toBe("received")
      })

      it("flags an amount mismatch for manual review instead of settling", async () => {
        const { virementId } = await freshVirementOrder("SCS-CSV2-0002", "1200.00")
        const csv = ["Libellé;Montant", "VIR SCS-CSV2-0002;1 100,00"].join("\n")

        const res = await app.inject({
          method: "POST",
          url: "/api/admin/payments/import",
          headers: adminAuth(),
          payload: { csv },
        })
        expect(res.statusCode).toBe(200)
        const { data } = res.json()
        expect(data).toMatchObject({ reconciled: 0, needsReview: 1 })
        expect(data.lines[0]).toMatchObject({ outcome: "amount_mismatch", amountExpectedTtc: "1200.00" })
        const [row] = await db.select().from(paymentVirement).where(eq(paymentVirement.id, virementId))
        expect(row.paymentStatus).toBe("awaiting_transfer") // untouched
      })

      it("classifies unknown references, missing references and debits", async () => {
        const csv = [
          "Libellé;Montant",
          "VIR SCS-ZZZZ-ZZZZ INCONNU;1 200,00",
          "ACHAT CARTE SANS REF;50,00",
          "VIR SCS-CSV3-0003 REMBOURSEMENT;-30,00",
        ].join("\n")

        const res = await app.inject({
          method: "POST",
          url: "/api/admin/payments/import",
          headers: adminAuth(),
          payload: { csv },
        })
        expect(res.statusCode).toBe(200)
        const outcomes = res.json().data.lines.map((l: { outcome: string }) => l.outcome)
        expect(outcomes).toEqual(["unknown_reference", "no_reference", "not_a_credit"])
      })

      it("is idempotent: re-importing a settled statement reconciles nothing new", async () => {
        await freshVirementOrder("SCS-CSV4-0004", "1200.00")
        const csv = ["Libellé;Montant", "VIR SCS-CSV4-0004;1 200,00"].join("\n")
        const inject = () =>
          app.inject({ method: "POST", url: "/api/admin/payments/import", headers: adminAuth(), payload: { csv } })

        expect((await inject()).json().data.reconciled).toBe(1)
        const second = (await inject()).json().data
        expect(second.reconciled).toBe(0)
        expect(second.lines[0].outcome).toBe("unknown_reference") // ref no longer outstanding
      })

      it("returns 400 on an unparseable statement", async () => {
        const res = await app.inject({
          method: "POST",
          url: "/api/admin/payments/import",
          headers: adminAuth(),
          payload: { csv: "foo;bar\n1;2" },
        })
        expect(res.statusCode).toBe(400)
        expect(res.json().error).toBe("InvalidStatement")
      })
    })
  })

  describe("refunds (Story 6.4)", () => {
    const adminAuth = (t = adminToken) => ({ authorization: `Bearer ${t}` })

    async function insertCustomer(suffix: string) {
      const [u] = await db
        .insert(users)
        .values({
          email: `pay-test61-${suffix}@pay-test.local`,
          passwordHash: "x",
          role: "customer",
          rgpdConsentAt: new Date(),
          rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
        })
        .returning({ id: users.id })
      return u.id
    }

    async function seedPaidCardOrder(owner: string, amount: string, items: ItemsJson, intentId: string) {
      const [o] = await db
        .insert(orders)
        .values({
          userId: owner,
          itemsJson: items,
          subtotalHt: amount,
          vatAmount: "0.00",
          totalTtc: amount,
          paymentStatus: "received",
        })
        .returning({ id: orders.id })
      await db.insert(paymentCarte).values({
        orderId: o.id,
        amountTtc: amount,
        currency: "EUR",
        paymentStatus: "received",
        stripePaymentIntentId: intentId,
      })
      return o.id
    }

    async function seedPaidVirementOrder(owner: string, amount: string, items: ItemsJson) {
      const [o] = await db
        .insert(orders)
        .values({
          userId: owner,
          itemsJson: items,
          subtotalHt: amount,
          vatAmount: "0.00",
          totalTtc: amount,
          paymentStatus: "received",
        })
        .returning({ id: orders.id })
      await db.insert(paymentVirement).values({
        orderId: o.id,
        amountExpectedTtc: amount,
        amountReceivedTtc: amount,
        currency: "EUR",
        ibanRecipient: "FR7630006000011234567890189",
        paymentReference: `REF-${o.id}`,
        paymentStatus: "reconciled",
        reconciledAt: new Date(),
      })
      return o.id
    }

    function refund(orderId: string, body: object, t = adminToken) {
      return app.inject({
        method: "POST",
        url: `/api/admin/payments/orders/${orderId}/refunds`,
        headers: { authorization: `Bearer ${t}` },
        payload: body,
      })
    }

    describe("card refunds (Stripe)", () => {
      it("partial refund flags the order partially_refunded and calls Stripe with the cents amount", async () => {
        const orderId = await seedPaidCardOrder(userId, "100.00", [CARD_ITEM], "pi_rf_p1")
        vi.mocked(createRefund).mockResolvedValue({ id: "re_p1", status: "succeeded" } as never)

        const res = await refund(orderId, { channel: "carte", amount: 40 })
        expect(res.statusCode).toBe(201)
        expect(res.json().data).toMatchObject({
          status: "succeeded",
          orderPaymentStatus: "partially_refunded",
          stripeRefundId: "re_p1",
        })
        expect(vi.mocked(createRefund)).toHaveBeenCalledWith(
          expect.objectContaining({ payment_intent: "pi_rf_p1", amount: 4000 }),
        )
        const [order] = await db.select().from(orders).where(eq(orders.id, orderId))
        expect(order.paymentStatus).toBe("partially_refunded")
      })

      it("full refund flips the order to refunded", async () => {
        const orderId = await seedPaidCardOrder(userId, "100.00", [CARD_ITEM], "pi_rf_f1")
        vi.mocked(createRefund).mockResolvedValue({ id: "re_f1", status: "succeeded" } as never)

        const res = await refund(orderId, { channel: "carte", amount: 100 })
        expect(res.statusCode).toBe(201)
        expect(res.json().data.orderPaymentStatus).toBe("refunded")
        const [order] = await db.select().from(orders).where(eq(orders.id, orderId))
        expect(order.paymentStatus).toBe("refunded")
      })

      it("restores variant stock on a full refund of a real order", async () => {
        const [beforeRow] = await db
          .select({ stock: productVariants.stockQty })
          .from(productVariants)
          .where(eq(productVariants.id, accessoryVariantId))
        const startStock = beforeRow.stock ?? 0

        await db.insert(cartItems).values({ userId, variantId: accessoryVariantId, qty: 1, priceHtAtTime: "50.00" })
        const created = (
          await app.inject({
            method: "POST",
            url: "/api/orders",
            headers: adminAuth(token),
            payload: { shippingAddressId },
          })
        ).json().data
        const [afterOrder] = await db
          .select({ stock: productVariants.stockQty })
          .from(productVariants)
          .where(eq(productVariants.id, accessoryVariantId))
        expect(afterOrder.stock).toBe(startStock - 1)

        // Simulate the card payment having settled
        await db
          .update(paymentCarte)
          .set({ paymentStatus: "received", stripePaymentIntentId: "pi_stock" })
          .where(eq(paymentCarte.orderId, created.id))
        await db.update(orders).set({ paymentStatus: "received" }).where(eq(orders.id, created.id))
        vi.mocked(createRefund).mockResolvedValue({ id: "re_stock", status: "succeeded" } as never)

        const res = await refund(created.id, { channel: "carte", amount: created.totals.totalTtc })
        expect(res.statusCode).toBe(201)
        expect(res.json().data.orderPaymentStatus).toBe("refunded")
        const [restored] = await db
          .select({ stock: productVariants.stockQty })
          .from(productVariants)
          .where(eq(productVariants.id, accessoryVariantId))
        expect(restored.stock).toBe(startStock)
      })

      it("releases reserved Gun Art prints on a full refund", async () => {
        const [product] = await db
          .insert(products)
          .values({
            sku: `${PREFIX}art`,
            slug: `${PREFIX}art`,
            name: "Oeuvre",
            categoryId: await categoryId("accessoire-tireur"),
            legalCategoryId: await legalCategoryId("none"),
            priceHt: "200.00",
            requiresLegalVerification: false,
            published: true,
          })
          .returning({ id: products.id })
        const [artwork] = await db
          .insert(artworks)
          .values({
            productId: product.id,
            slug: `${PREFIX}art`,
            sku: `${PREFIX}art`,
            title: "Oeuvre",
            editionLimit: 25,
            basePriceHt: "200.00",
            priceIncrementHt: "10.00",
          })
          .returning({ id: artworks.id })
        const [print] = await db
          .insert(artworkPrints)
          .values({
            artworkId: artwork.id,
            printNumber: 1,
            totalPrints: 25,
            printDesignation: `${PREFIX}1/25`,
            formatId: "a4",
            priceHtUnit: "200.00",
            status: "reserved",
          })
          .returning({ id: artworkPrints.id })
        const orderId = await seedPaidCardOrder(
          userId,
          "200.00",
          [
            {
              printId: print.id,
              qty: 1,
              priceHt: 200,
              name: "Oeuvre",
              sku: `${PREFIX}art`,
              category: "gun-art",
              requiresPaymentVirement: false,
            },
          ],
          "pi_print",
        )
        await db.update(artworkPrints).set({ orderId }).where(eq(artworkPrints.id, print.id))
        vi.mocked(createRefund).mockResolvedValue({ id: "re_print", status: "succeeded" } as never)

        const res = await refund(orderId, { channel: "carte", amount: 200 })
        expect(res.statusCode).toBe(201)
        const [released] = await db.select().from(artworkPrints).where(eq(artworkPrints.id, print.id))
        expect(released.status).toBe("available")
        expect(released.orderId).toBeNull()
      })

      it("settles a pending card refund only when the webhook confirms it (idempotent)", async () => {
        const orderId = await seedPaidCardOrder(userId, "100.00", [CARD_ITEM], "pi_async")
        vi.mocked(createRefund).mockResolvedValue({ id: "re_async", status: "pending" } as never)

        const res = await refund(orderId, { channel: "carte", amount: 100 })
        expect(res.statusCode).toBe(201)
        expect(res.json().data).toMatchObject({ status: "pending", orderPaymentStatus: "received" })
        const [pending] = await db.select().from(orders).where(eq(orders.id, orderId))
        expect(pending.paymentStatus).toBe("received") // not refunded until confirmed

        vi.mocked(constructWebhookEvent).mockReturnValue({
          type: "charge.refunded",
          data: { object: { refunds: { data: [{ id: "re_async", status: "succeeded" }] } } },
        } as never)
        const fire = () =>
          app.inject({
            method: "POST",
            url: "/api/webhooks/stripe",
            headers: { "stripe-signature": "sig", "content-type": "application/json" },
            payload: JSON.stringify({}),
          })

        expect((await fire()).statusCode).toBe(200)
        const [settled] = await db.select().from(orders).where(eq(orders.id, orderId))
        expect(settled.paymentStatus).toBe("refunded")

        // Replaying the same event changes nothing
        expect((await fire()).statusCode).toBe(200)
        const settledRefunds = await db.select().from(refunds).where(eq(refunds.stripeRefundId, "re_async"))
        expect(settledRefunds).toHaveLength(1)
        expect(settledRefunds[0].status).toBe("succeeded")
      })
    })

    describe("bank-transfer refunds (manual) + VIP cascade", () => {
      it("full refund revokes VIP earned from that order (no Stripe call)", async () => {
        const vipUser = await insertCustomer("rvip1")
        const orderId = await seedPaidVirementOrder(vipUser, "1200.00", [FIREARM_ITEM])
        expect(await recomputeVipStatus(vipUser)).toBe(true)

        const res = await refund(orderId, { channel: "virement", amount: 1200 })
        expect(res.statusCode).toBe(201)
        expect(res.json().data).toMatchObject({
          status: "succeeded",
          orderPaymentStatus: "refunded",
          stripeRefundId: null,
        })
        expect(vi.mocked(createRefund)).not.toHaveBeenCalled()

        const [u] = await db.select({ vipActive: users.vipActive }).from(users).where(eq(users.id, vipUser))
        expect(u.vipActive).toBe(false)
      })

      it("partial refund keeps the order paid and VIP intact", async () => {
        const vipUser = await insertCustomer("rvip2")
        const orderId = await seedPaidVirementOrder(vipUser, "1200.00", [FIREARM_ITEM])
        expect(await recomputeVipStatus(vipUser)).toBe(true)

        const res = await refund(orderId, { channel: "virement", amount: 300 })
        expect(res.statusCode).toBe(201)
        expect(res.json().data.orderPaymentStatus).toBe("partially_refunded")

        const [u] = await db.select({ vipActive: users.vipActive }).from(users).where(eq(users.id, vipUser))
        expect(u.vipActive).toBe(true)
      })
    })

    describe("guards", () => {
      it("rejects an amount above what is refundable (400)", async () => {
        const orderId = await seedPaidCardOrder(userId, "100.00", [CARD_ITEM], "pi_guard1")
        const res = await refund(orderId, { channel: "carte", amount: 150 })
        expect(res.statusCode).toBe(400)
        expect(res.json().error).toBe("AmountExceedsRefundable")
      })

      it("caps cumulative refunds at the amount paid (400 on the overflow)", async () => {
        const orderId = await seedPaidCardOrder(userId, "100.00", [CARD_ITEM], "pi_guard2")
        vi.mocked(createRefund).mockResolvedValue({ id: "re_g2", status: "succeeded" } as never)
        expect((await refund(orderId, { channel: "carte", amount: 60 })).statusCode).toBe(201)
        const res = await refund(orderId, { channel: "carte", amount: 60 })
        expect(res.statusCode).toBe(400)
        expect(res.json().error).toBe("AmountExceedsRefundable")
      })

      it("rejects refunding a channel the order did not pay (400)", async () => {
        const orderId = await seedPaidCardOrder(userId, "100.00", [CARD_ITEM], "pi_guard3")
        const res = await refund(orderId, { channel: "virement", amount: 10 })
        expect(res.statusCode).toBe(400)
        expect(res.json().error).toBe("ChannelNotPaid")
      })

      it("rejects refunding an unpaid order (400)", async () => {
        const orderId = await insertOrder(userId, [CARD_ITEM])
        await insertCarte(orderId)
        const res = await refund(orderId, { channel: "carte", amount: 10 })
        expect(res.statusCode).toBe(400)
        expect(res.json().error).toBe("NotRefundable")
      })

      it("returns 404 for an unknown order", async () => {
        const res = await refund("00000000-0000-0000-0000-000000000000", { channel: "carte", amount: 10 })
        expect(res.statusCode).toBe(404)
      })

      it("requires the admin role (403 customer, 401 anonymous)", async () => {
        const orderId = await seedPaidCardOrder(userId, "100.00", [CARD_ITEM], "pi_guard4")
        expect((await refund(orderId, { channel: "carte", amount: 10 }, token)).statusCode).toBe(403)
        const anon = await app.inject({
          method: "POST",
          url: `/api/admin/payments/orders/${orderId}/refunds`,
          payload: { channel: "carte", amount: 10 },
        })
        expect(anon.statusCode).toBe(401)
      })
    })

    describe("GET /api/admin/payments/orders/:orderId/refunds", () => {
      it("lists the refund history for an order", async () => {
        const orderId = await seedPaidCardOrder(userId, "100.00", [CARD_ITEM], "pi_list")
        vi.mocked(createRefund).mockResolvedValue({ id: "re_list", status: "succeeded" } as never)
        await refund(orderId, { channel: "carte", amount: 25, reason: "goodwill" })

        const res = await app.inject({
          method: "GET",
          url: `/api/admin/payments/orders/${orderId}/refunds`,
          headers: adminAuth(),
        })
        expect(res.statusCode).toBe(200)
        const { data } = res.json()
        expect(data).toHaveLength(1)
        expect(data[0]).toMatchObject({ channel: "carte", amountTtc: "25.00", status: "succeeded", reason: "goodwill" })
      })
    })
  })
})
