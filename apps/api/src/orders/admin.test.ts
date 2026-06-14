import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, orders, paymentCarte, refunds, users } from "../db/schema.js"

const PREFIX = "ADMORD-"
const PASSWORD = "MotDePasseTresLong123!"
const ADMIN_EMAIL = "admord-admin@admord.local"
const CUSTOMER_EMAIL = "admord-cust@admord.local"

type ItemsJson = (typeof orders.$inferInsert)["itemsJson"]

const ITEM: NonNullable<ItemsJson>[number] = {
  qty: 2,
  priceHt: 100,
  name: "Carabine",
  sku: `${PREFIX}reg`,
  category: "arme-longue",
  legalCategory: "B",
  requiresPaymentVirement: true,
}

describe("admin orders dashboard API (Story 7.1)", () => {
  let app: FastifyInstance
  let adminToken: string
  let customerId: string
  let customerToken: string

  async function cleanup() {
    const userIds = db.select({ id: users.id }).from(users).where(like(users.email, "admord-%"))
    const orderIds = db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, userIds))
    await db.delete(refunds).where(inArray(refunds.orderId, orderIds))
    await db.delete(paymentCarte).where(inArray(paymentCarte.orderId, orderIds))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
    await db.delete(orders).where(inArray(orders.userId, userIds))
    await db.delete(users).where(like(users.email, "admord-%"))
  }

  async function makeUser(email: string, role: "customer" | "admin") {
    const passwordHash = await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
    const [u] = await db
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
    return { id: u.id, token: login.json().accessToken as string }
  }

  async function insertOrder(
    owner: string,
    opts: { paymentStatus?: string; legalStatus?: string; totalTtc?: string } = {},
  ) {
    const [o] = await db
      .insert(orders)
      .values({
        userId: owner,
        itemsJson: [ITEM],
        subtotalHt: "200.00",
        vatAmount: "40.00",
        totalTtc: opts.totalTtc ?? "240.00",
        // biome-ignore lint/suspicious/noExplicitAny: enum string injected directly in tests
        paymentStatus: (opts.paymentStatus ?? "pending") as any,
        // biome-ignore lint/suspicious/noExplicitAny: enum string injected directly in tests
        legalVerificationStatus: (opts.legalStatus ?? "pending") as any,
      })
      .returning({ id: orders.id })
    return o.id
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()
    const admin = await makeUser(ADMIN_EMAIL, "admin")
    adminToken = admin.token
    const customer = await makeUser(CUSTOMER_EMAIL, "customer")
    customerId = customer.id
    customerToken = customer.token
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  const adminGet = (url: string, token = adminToken) =>
    app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } })

  describe("auth", () => {
    it("rejects a customer with 403", async () => {
      expect((await adminGet("/api/admin/orders", customerToken)).statusCode).toBe(403)
    })
    it("rejects an anonymous caller with 401", async () => {
      expect((await app.inject({ method: "GET", url: "/api/admin/orders" })).statusCode).toBe(401)
    })
  })

  describe("GET /api/admin/orders", () => {
    it("lists orders across customers with the owner and an item count (200)", async () => {
      const orderId = await insertOrder(customerId, { paymentStatus: "received", totalTtc: "240.00" })

      const res = await adminGet("/api/admin/orders?limit=100")
      expect(res.statusCode).toBe(200)
      const { data, pagination } = res.json()
      expect(pagination).toMatchObject({ page: 1, limit: 100 })
      const mine = data.find((o: { id: string }) => o.id === orderId)
      expect(mine).toMatchObject({
        paymentStatus: "received",
        totalTtc: 240,
        itemCount: 2,
        user: { email: CUSTOMER_EMAIL },
      })
    })

    it("filters by paymentStatus", async () => {
      await insertOrder(customerId, { paymentStatus: "refunded" })
      const res = await adminGet("/api/admin/orders?paymentStatus=refunded&limit=100")
      const statuses = res.json().data.map((o: { paymentStatus: string }) => o.paymentStatus)
      expect(statuses.length).toBeGreaterThan(0)
      expect(statuses.every((s: string) => s === "refunded")).toBe(true)
    })

    it("filters by legalStatus", async () => {
      await insertOrder(customerId, { legalStatus: "docs_rejected" })
      const res = await adminGet("/api/admin/orders?legalStatus=docs_rejected&limit=100")
      const statuses = res.json().data.map((o: { legalVerificationStatus: string }) => o.legalVerificationStatus)
      expect(statuses.length).toBeGreaterThan(0)
      expect(statuses.every((s: string) => s === "docs_rejected")).toBe(true)
    })

    it("searches by customer email", async () => {
      await insertOrder(customerId)
      const hit = await adminGet(`/api/admin/orders?search=${encodeURIComponent("admord-cust")}&limit=100`)
      expect(hit.json().data.length).toBeGreaterThan(0)
      const miss = await adminGet("/api/admin/orders?search=nobody-xyz@nowhere.local")
      expect(miss.json().data).toHaveLength(0)
    })

    it("rejects an out-of-range status filter (400)", async () => {
      expect((await adminGet("/api/admin/orders?paymentStatus=bogus")).statusCode).toBe(400)
    })
  })

  describe("GET /api/admin/orders/:id", () => {
    it("returns full detail with the card bucket and refunds (200)", async () => {
      const orderId = await insertOrder(customerId, { paymentStatus: "received", totalTtc: "240.00" })
      await db.insert(paymentCarte).values({ orderId, amountTtc: "240.00", currency: "EUR", paymentStatus: "received" })
      await db
        .insert(refunds)
        .values({ orderId, channel: "carte", amountTtc: "40.00", status: "succeeded", currency: "EUR" })

      const res = await adminGet(`/api/admin/orders/${orderId}`)
      expect(res.statusCode).toBe(200)
      const { data } = res.json()
      expect(data).toMatchObject({ id: orderId, totalTtc: 240, user: { email: CUSTOMER_EMAIL } })
      expect(data.payment.carte).toMatchObject({ amountTtc: "240.00", paymentStatus: "received" })
      expect(data.payment.refunds).toHaveLength(1)
      expect(data.payment.refunds[0]).toMatchObject({ channel: "carte", amountTtc: "40.00", status: "succeeded" })
    })

    it("returns 404 for an unknown order", async () => {
      expect((await adminGet("/api/admin/orders/00000000-0000-0000-0000-000000000000")).statusCode).toBe(404)
    })

    it("returns 400 for a malformed id", async () => {
      expect((await adminGet("/api/admin/orders/not-a-uuid")).statusCode).toBe(400)
    })
  })

  describe("GET /api/admin/orders/summary", () => {
    it("returns headline counts for the dashboard", async () => {
      const res = await adminGet("/api/admin/orders/summary")
      expect(res.statusCode).toBe(200)
      const { data } = res.json()
      expect(data).toHaveProperty("totalOrders")
      expect(data).toHaveProperty("awaitingPayment")
      expect(data).toHaveProperty("paid")
      expect(data).toHaveProperty("docsToReview")
      expect(typeof data.totalOrders).toBe("number")
      expect(data.byPaymentStatus).toBeTypeOf("object")
    })

    it("is not shadowed by the :id route (403 for customer, not 400/404)", async () => {
      expect((await adminGet("/api/admin/orders/summary", customerToken)).statusCode).toBe(403)
    })
  })
})
