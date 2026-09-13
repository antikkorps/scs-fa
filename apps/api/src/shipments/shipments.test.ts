import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { and, eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import {
  auditLogs,
  legalCategories,
  orders,
  productCategories,
  products,
  productVariants,
  users,
} from "../db/schema.js"
import { sendShipmentShippedEmail } from "../email.js"

vi.mock("../email.js", () => ({
  sendShipmentShippedEmail: vi.fn().mockResolvedValue(undefined),
}))

const PASSWORD = "MotDePasseTresLong123!"
const ADMIN_EMAIL = "testship-admin@testship.local"
const CUSTOMER_EMAIL = "testship-cust@testship.local"
const PREFIX = "TESTSHIP-"
const BASE = "/api/admin/shipments"
const UNKNOWN_VARIANT = "99999999-9999-4999-8999-999999999999"

describe("multi-parcel shipping (story 11.9)", () => {
  let app: FastifyInstance
  let adminToken: string
  let customerToken: string
  let customerId: string
  let rifleVariantId: string
  let scopeVariantId: string
  let orderId: string

  async function cleanup() {
    const userIds = db.select({ id: users.id }).from(users).where(like(users.email, "testship-%"))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
    // Parcels and their content go with the order (ON DELETE CASCADE).
    await db.delete(orders).where(inArray(orders.userId, userIds))
    await db.delete(users).where(like(users.email, "testship-%"))
    await db.delete(products).where(like(products.sku, `${PREFIX}%`))
  }

  async function makeUser(email: string, role: "customer" | "admin") {
    const passwordHash = await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
    const [row] = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        role,
        firstname: "Test",
        lastname: role === "admin" ? "Admin" : "Client",
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id })
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } })
    return { id: row?.id as string, token: login.json().accessToken as string }
  }

  async function makeProduct(suffix: string, legal: "B" | "none", parcelCount: number) {
    const [category] = await db
      .select({ id: productCategories.id })
      .from(productCategories)
      .where(eq(productCategories.slug, "arme-longue"))
      .limit(1)
    const [legalCategory] = await db
      .select({ id: legalCategories.id })
      .from(legalCategories)
      .where(eq(legalCategories.category, legal))
      .limit(1)
    if (!category || !legalCategory) throw new Error("Missing seeded reference data (run db:seed)")

    const [product] = await db
      .insert(products)
      .values({
        sku: `${PREFIX}${suffix}`,
        slug: `${PREFIX.toLowerCase()}${suffix.toLowerCase()}`,
        name: `Article ${suffix}`,
        categoryId: category.id,
        legalCategoryId: legalCategory.id,
        priceHt: "1000.00",
        requiresLegalVerification: legal !== "none",
        parcelCount,
        published: true,
      })
      .returning({ id: products.id })
    if (!product) throw new Error("Product insert returned no row")
    const [variant] = await db
      .insert(productVariants)
      .values({ productId: product.id, skuVariant: `${PREFIX}${suffix}-A`, finition: "Standard", stockQty: 10 })
      .returning({ id: productVariants.id })
    if (!variant) throw new Error("Variant insert returned no row")
    return variant.id
  }

  async function placeOrder() {
    const [order] = await db
      .insert(orders)
      .values({
        userId: customerId,
        paymentStatus: "awaiting_transfer",
        legalVerificationStatus: "pending",
        itemsJson: [
          {
            variantId: rifleVariantId,
            qty: 1,
            priceHt: 1000,
            name: "Carabine cat. B",
            sku: `${PREFIX}RIFLE-A`,
            category: "arme-longue",
            legalCategory: "B",
            requiresPaymentVirement: true,
          },
          {
            variantId: scopeVariantId,
            qty: 2,
            priceHt: 100,
            name: "Lunette",
            sku: `${PREFIX}SCOPE-A`,
            category: "arme-longue",
            legalCategory: "none",
            requiresPaymentVirement: false,
          },
        ],
        subtotalHt: "1200.00",
        vatAmount: "240.00",
        totalTtc: "1440.00",
      })
      .returning({ id: orders.id })
    if (!order) throw new Error("Order insert returned no row")
    return order.id
  }

  const asAdmin = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${adminToken}` }, ...(body ? { payload: body } : {}) })

  const orderDetail = async () => (await asAdmin("GET", `/api/admin/orders/${orderId}`)).json().data

  /** Paid, documents validated: nothing holds the order back any more. */
  const clearOrder = () =>
    db
      .update(orders)
      .set({ paymentStatus: "received", legalVerificationStatus: "completed" })
      .where(eq(orders.id, orderId))

  const rifle = (part: number) => ({ variantId: rifleVariantId, qty: 1, part, parts: 2 })
  // Functions, not constants: the variant ids only exist once beforeAll has run.
  const scopes = () => ({ variantId: scopeVariantId, qty: 2 })

  const createParcel = (items: unknown[], extra: Record<string, unknown> = {}) =>
    asAdmin("POST", BASE, { orderId, carrier: "colissimo", trackingNumber: "6A0001", items, ...extra })

  const setStatus = (id: string, status: string) => asAdmin("PATCH", `${BASE}/${id}`, { status })

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()
    const admin = await makeUser(ADMIN_EMAIL, "admin")
    adminToken = admin.token
    const customer = await makeUser(CUSTOMER_EMAIL, "customer")
    customerToken = customer.token
    customerId = customer.id
    rifleVariantId = await makeProduct("RIFLE", "B", 2)
    scopeVariantId = await makeProduct("SCOPE", "none", 1)
  })

  beforeEach(async () => {
    await db.delete(orders).where(eq(orders.userId, customerId))
    orderId = await placeOrder()
    vi.mocked(sendShipmentShippedEmail).mockClear()
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it("refuses anyone but an admin", async () => {
    const payload = { orderId, carrier: "colissimo", items: [scopes()] }
    expect((await app.inject({ method: "POST", url: BASE, payload })).statusCode).toBe(401)
    const asCustomer = await app.inject({
      method: "POST",
      url: BASE,
      payload,
      headers: { authorization: `Bearer ${customerToken}` },
    })
    expect(asCustomer.statusCode).toBe(403)
  })

  it("suggests the category B firearm in two parcels, the rest travelling with the second", async () => {
    const data = await orderDetail()
    expect(data.shippingStatus).toBe("unshipped")
    expect(data.shipments).toEqual([])
    expect(data.shipGate).toEqual({ ok: false, reason: "unpaid" })
    expect(data.suggestedParcels).toEqual([
      { items: [{ variantId: rifleVariantId, name: "Carabine cat. B", qty: 1, part: 1, parts: 2 }] },
      {
        items: [
          { variantId: rifleVariantId, name: "Carabine cat. B", qty: 1, part: 2, parts: 2 },
          { variantId: scopeVariantId, name: "Lunette", qty: 2, part: 1, parts: 1 },
        ],
      },
    ])
  })

  /** Packing ahead of the money is fine; only handing over to the carrier is gated. */
  it("prepares a parcel before the order is even paid, and audits it", async () => {
    const res = await createParcel([rifle(1)], { notes: "Arme seule" })
    expect(res.statusCode).toBe(201)
    const parcel = res.json().data
    expect(parcel).toMatchObject({
      position: 1,
      status: "preparing",
      carrier: "colissimo",
      trackingNumber: "6A0001",
      trackingUrl: "https://www.laposte.fr/outils/suivre-vos-envois?code=6A0001",
      items: [{ variantId: rifleVariantId, label: "Carabine cat. B", qty: 1, part: 1, parts: 2 }],
    })

    const data = await orderDetail()
    expect(data.shippingStatus).toBe("unshipped")
    expect(data.shipments).toHaveLength(1)
    // What is already packed is no longer suggested.
    expect(data.suggestedParcels).toHaveLength(1)

    const audit = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, "shipment"), eq(auditLogs.entityId, parcel.id)))
    expect(audit.map((a) => a.action)).toContain("shipment.created")
  })

  it("refuses to pack what the order does not hold", async () => {
    expect((await createParcel([{ variantId: scopeVariantId, qty: 3 }])).statusCode).toBe(400)
    expect((await createParcel([{ variantId: UNKNOWN_VARIANT, qty: 1 }])).statusCode).toBe(400)

    expect((await createParcel([rifle(1)])).statusCode).toBe(201)
    // Half 1/2 is already in a parcel: a second one, or a 1/3 split, makes no sense.
    expect((await createParcel([rifle(1)])).statusCode).toBe(400)
    expect((await createParcel([{ variantId: rifleVariantId, qty: 1, part: 2, parts: 3 }])).statusCode).toBe(400)
  })

  it("refuses an unknown carrier, and a pasted link for a listed one", async () => {
    expect((await createParcel([scopes()], { carrier: "pigeon" })).statusCode).toBe(400)
    expect((await createParcel([scopes()], { trackingUrl: "https://evil.example/track" })).statusCode).toBe(400)

    const other = await createParcel([scopes()], {
      carrier: "other",
      trackingNumber: undefined,
      trackingUrl: "https://suivi.transporteur.example/42",
    })
    expect(other.statusCode).toBe(201)
    expect(other.json().data.trackingUrl).toBe("https://suivi.transporteur.example/42")
  })

  it("does not let a parcel leave before the order is paid", async () => {
    const parcel = (await createParcel([scopes()])).json().data
    const res = await setStatus(parcel.id, "shipped")
    expect(res.statusCode).toBe(409)
    expect(res.json().message).toMatch(/paid/)
    expect(sendShipmentShippedEmail).not.toHaveBeenCalled()
  })

  it("does not let a regulated firearm leave before its documents are validated", async () => {
    await db
      .update(orders)
      .set({ paymentStatus: "received", legalVerificationStatus: "docs_verifying" })
      .where(eq(orders.id, orderId))
    const parcel = (await createParcel([rifle(1)])).json().data
    const res = await setStatus(parcel.id, "shipped")
    expect(res.statusCode).toBe(409)
    expect(res.json().message).toMatch(/documents/)
    expect((await orderDetail()).shipGate).toEqual({ ok: false, reason: "legal" })
  })

  it("requires a tracking number to hand a parcel to a listed carrier", async () => {
    await clearOrder()
    const parcel = (await createParcel([scopes()], { trackingNumber: undefined })).json().data
    expect((await setStatus(parcel.id, "shipped")).statusCode).toBe(400)

    await asAdmin("PATCH", `${BASE}/${parcel.id}`, { trackingNumber: "6A0002" })
    expect((await setStatus(parcel.id, "shipped")).statusCode).toBe(200)
  })

  /**
   * The whole story in one run: a category B firearm in two parcels only counts
   * as shipped once BOTH halves have left, and the customer hears about each
   * parcel exactly once.
   */
  it("ships parcel by parcel, mailing the customer once per parcel", async () => {
    await clearOrder()
    const first = (await createParcel([rifle(1)])).json().data
    const second = (await createParcel([rifle(2), scopes()], { trackingNumber: "6A0002" })).json().data

    const shipped = await setStatus(first.id, "shipped")
    expect(shipped.statusCode).toBe(200)
    expect(shipped.json().data.shippedAt).toBeTruthy()
    expect((await orderDetail()).shippingStatus).toBe("partially_shipped")
    expect(sendShipmentShippedEmail).toHaveBeenCalledTimes(1)
    expect(sendShipmentShippedEmail).toHaveBeenCalledWith(
      CUSTOMER_EMAIL,
      expect.objectContaining({
        orderRef: orderId.slice(0, 8).toUpperCase(),
        position: 1,
        total: 2,
        carrierLabel: "Colissimo",
        trackingUrl: "https://www.laposte.fr/outils/suivre-vos-envois?code=6A0001",
      }),
    )

    // A correction back and forth must not mail the customer a second time.
    expect((await setStatus(first.id, "preparing")).statusCode).toBe(200)
    expect((await setStatus(first.id, "shipped")).statusCode).toBe(200)
    expect(sendShipmentShippedEmail).toHaveBeenCalledTimes(1)

    expect((await setStatus(second.id, "shipped")).statusCode).toBe(200)
    expect((await orderDetail()).shippingStatus).toBe("shipped")
    expect(sendShipmentShippedEmail).toHaveBeenCalledTimes(2)

    expect((await setStatus(first.id, "delivered")).statusCode).toBe(200)
    expect((await orderDetail()).shippingStatus).toBe("shipped")
    const delivered = await setStatus(second.id, "delivered")
    expect(delivered.json().data.deliveredAt).toBeTruthy()
    expect((await orderDetail()).shippingStatus).toBe("delivered")

    const audit = await db.select().from(auditLogs).where(eq(auditLogs.entityId, first.id))
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["shipment.shipped", "shipment.delivered"]))
  })

  it("keeps the parcel shipped when the e-mail provider fails", async () => {
    await clearOrder()
    vi.mocked(sendShipmentShippedEmail).mockRejectedValueOnce(new Error("SMTP down"))
    const parcel = (await createParcel([scopes()])).json().data
    expect((await setStatus(parcel.id, "shipped")).statusCode).toBe(200)

    // The claim was released: the next legitimate transition may try again.
    await setStatus(parcel.id, "preparing")
    await setStatus(parcel.id, "shipped")
    expect(sendShipmentShippedEmail).toHaveBeenCalledTimes(2)
  })

  it("refuses to deliver a parcel that never left", async () => {
    await clearOrder()
    const parcel = (await createParcel([scopes()])).json().data
    expect((await setStatus(parcel.id, "delivered")).statusCode).toBe(409)
  })

  it("deletes a parcel still being prepared, never one that has left", async () => {
    await clearOrder()
    const first = (await createParcel([rifle(1)])).json().data
    const second = (await createParcel([rifle(2), scopes()])).json().data
    await setStatus(first.id, "shipped")

    expect((await asAdmin("DELETE", `${BASE}/${first.id}`)).statusCode).toBe(409)
    expect((await asAdmin("DELETE", `${BASE}/${second.id}`)).statusCode).toBe(204)
    expect((await asAdmin("DELETE", `${BASE}/${second.id}`)).statusCode).toBe(404)

    const data = await orderDetail()
    expect(data.shipments).toHaveLength(1)
    expect(data.shippingStatus).toBe("partially_shipped")
  })

  it("shows the customer where each parcel is, without the internal notes", async () => {
    await clearOrder()
    const parcel = (await createParcel([rifle(1)], { notes: "Note interne confidentielle" })).json().data
    await setStatus(parcel.id, "shipped")

    const res = await app.inject({
      method: "GET",
      url: `/api/orders/${orderId}`,
      headers: { authorization: `Bearer ${customerToken}` },
    })
    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data.shippingStatus).toBe("partially_shipped")
    expect(data.shipments).toEqual([
      {
        position: 1,
        status: "shipped",
        carrier: "colissimo",
        carrierLabel: "Colissimo",
        trackingNumber: "6A0001",
        trackingUrl: "https://www.laposte.fr/outils/suivre-vos-envois?code=6A0001",
        shippedAt: expect.any(String),
        deliveredAt: null,
        items: [{ label: "Carabine cat. B", qty: 1, part: 1, parts: 2 }],
      },
    ])
    expect(res.body).not.toContain("Note interne confidentielle")
  })

  it("filters the admin order list by shipping status", async () => {
    await clearOrder()
    const parcel = (await createParcel([rifle(1)])).json().data
    await setStatus(parcel.id, "shipped")

    const res = await asAdmin("GET", "/api/admin/orders?shippingStatus=partially_shipped&limit=100")
    expect(res.statusCode).toBe(200)
    const rows = res.json().data as Array<{ id: string; shippingStatus: string }>
    expect(rows.find((o) => o.id === orderId)?.shippingStatus).toBe("partially_shipped")
    expect(rows.every((o) => o.shippingStatus === "partially_shipped")).toBe(true)
  })
})
