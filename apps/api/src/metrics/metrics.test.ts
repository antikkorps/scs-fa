import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, legalDocuments, orders, refunds, users } from "../db/schema.js"

// Test data lives in a historical window (March 2025) so the period filter
// isolates it from every other suite's `now`-dated rows on the shared database.
const PREFIX = "metrics-test"
const PASSWORD = "MotDePasseTresLong123!"
const ADMIN_EMAIL = `${PREFIX}-admin@${PREFIX}.local`
const CUSTOMER_EMAIL = `${PREFIX}-cust@${PREFIX}.local`
const FROM = "2025-03-01"
const TO = "2025-03-31"

type ItemsJson = (typeof orders.$inferInsert)["itemsJson"]
const ITEMS: ItemsJson = [
  {
    qty: 1,
    priceHt: 100,
    name: "X",
    sku: `${PREFIX}-x`,
    category: "arme-longue",
    legalCategory: "B",
    requiresPaymentVirement: true,
  },
]

describe("admin metrics API (Story 7.3)", () => {
  let app: FastifyInstance
  let adminToken: string
  let customerToken: string
  let customerId: string

  async function cleanup() {
    const userIds = db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `${PREFIX}%`))
    const orderIds = db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, userIds))
    await db.delete(refunds).where(inArray(refunds.orderId, orderIds))
    await db.delete(legalDocuments).where(inArray(legalDocuments.userId, userIds))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
    await db.delete(orders).where(inArray(orders.userId, userIds))
    await db.delete(users).where(like(users.email, `${PREFIX}%`))
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
        lastname: role,
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id })
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } })
    return { id: u.id, token: login.json().accessToken as string }
  }

  async function insertOrder(totalTtc: string, paymentStatus: string, isoDate: string) {
    const [o] = await db
      .insert(orders)
      .values({
        userId: customerId,
        itemsJson: ITEMS,
        subtotalHt: totalTtc,
        vatAmount: "0.00",
        totalTtc,
        // biome-ignore lint/suspicious/noExplicitAny: enum string injected directly in tests
        paymentStatus: paymentStatus as any,
        createdAt: new Date(`${isoDate}T12:00:00.000Z`),
      })
      .returning({ id: orders.id })
    return o.id
  }

  async function insertRefund(orderId: string, amountTtc: string, status: "succeeded" | "failed") {
    await db.insert(refunds).values({ orderId, channel: "carte", amountTtc, status, currency: "EUR" })
  }

  async function insertDoc(opts: {
    status: "approved" | "rejected" | "pending"
    uploadedAt: string
    verifiedAt?: string
    deadline: string
  }) {
    await db.insert(legalDocuments).values({
      userId: customerId,
      docType: "cni",
      s3Key: `legal-documents/${customerId}/${opts.uploadedAt}.pdf`,
      s3Url: `memory://x`,
      mimeType: "application/pdf",
      fileSize: 100,
      scanStatus: "clean",
      verificationStatus: opts.status,
      uploadedAt: new Date(`${opts.uploadedAt}T00:00:00.000Z`),
      verifiedAt: opts.verifiedAt ? new Date(opts.verifiedAt) : null,
      verificationDeadline: new Date(`${opts.deadline}T00:00:00.000Z`),
    } as typeof legalDocuments.$inferInsert)
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

    // Revenue / funnel orders (March 2025) + one outside the window
    const a = await insertOrder("240.00", "received", "2025-03-10")
    const b = await insertOrder("100.00", "reconciled", "2025-03-12")
    const f = await insertOrder("200.00", "partially_refunded", "2025-03-11")
    await insertOrder("60.00", "pending", "2025-03-15")
    await insertOrder("500.00", "refunded", "2025-03-20")
    await insertOrder("1000.00", "received", "2025-01-05") // outside the period

    await insertRefund(a, "40.00", "succeeded")
    await insertRefund(f, "50.00", "succeeded")
    await insertRefund(b, "20.00", "failed") // ignored

    // Legal SLA: one decided within deadline, one late, one pending+overdue
    await insertDoc({
      status: "approved",
      uploadedAt: "2025-03-05",
      verifiedAt: "2025-03-05T10:00:00.000Z",
      deadline: "2025-03-07",
    })
    await insertDoc({
      status: "rejected",
      uploadedAt: "2025-03-06",
      verifiedAt: "2025-03-10T00:00:00.000Z",
      deadline: "2025-03-08",
    })
    await insertDoc({ status: "pending", uploadedAt: "2025-03-01", deadline: "2025-03-03" })
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  const get = (url: string, token = adminToken) =>
    app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } })

  it("requires the admin role (403 customer, 401 anonymous)", async () => {
    expect((await get("/api/admin/metrics", customerToken)).statusCode).toBe(403)
    expect((await app.inject({ method: "GET", url: "/api/admin/metrics" })).statusCode).toBe(401)
  })

  it("computes net revenue and the 5% commission over the period", async () => {
    const { data } = (await get(`/api/admin/metrics?from=${FROM}&to=${TO}`)).json()
    expect(data.revenue).toMatchObject({ grossTtc: 540, refundedTtc: 90, netTtc: 450, paidOrders: 3 })
    expect(data.commission).toMatchObject({ ratePct: 5, amount: 22.5 })
  })

  it("computes the order funnel and conversion", async () => {
    const { data } = (await get(`/api/admin/metrics?from=${FROM}&to=${TO}`)).json()
    expect(data.funnel).toMatchObject({
      totalOrders: 5,
      paidOrders: 3,
      pendingOrders: 1,
      refundedOrders: 1,
      failedOrders: 0,
      conversionPct: 60,
    })
  })

  it("computes legal SLA performance", async () => {
    const { data } = (await get(`/api/admin/metrics?from=${FROM}&to=${TO}`)).json()
    expect(data.legalSla).toMatchObject({ reviewed: 2, withinSla: 1, withinSlaPct: 50, avgReviewHours: 53 })
    expect(data.legalSla.pendingOverdue).toBeGreaterThanOrEqual(1)
  })

  it("returns a daily revenue timeseries (paid gross, oldest first)", async () => {
    const { data } = (await get(`/api/admin/metrics?from=${FROM}&to=${TO}`)).json()
    expect(data.timeseries).toEqual([
      { date: "2025-03-10", grossTtc: 240 },
      { date: "2025-03-11", grossTtc: 200 },
      { date: "2025-03-12", grossTtc: 100 },
    ])
  })

  it("defaults to a trailing window when no dates are given (200)", async () => {
    const res = await get("/api/admin/metrics")
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveProperty("revenue")
  })

  it("rejects an inverted period (400)", async () => {
    expect((await get("/api/admin/metrics?from=2025-03-31&to=2025-03-01")).statusCode).toBe(400)
  })
})
