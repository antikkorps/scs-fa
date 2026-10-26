import { CURRENT_RGPD_CONSENT_VERSION, orderReference } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import {
  auditLogs,
  beneficiaries,
  beneficiaryPayouts,
  henrriDocuments,
  legalCategories,
  orders,
  productCategories,
  products,
  productVariants,
  refunds,
  users,
} from "../db/schema.js"
import { signIn } from "../test/sign-in.js"
import { createPayoutsForOrder, settlePayoutsForOrder } from "./service.js"

const PASSWORD = "MotDePasseTresLong123!"
const ADMIN_EMAIL = "testpayout-admin@testpayout.local"
const CUSTOMER_EMAIL = "testpayout-cust@testpayout.local"
const PREFIX = "TESTPAYOUT-"
const BASE = "/api/admin/finance"
const PARIS_DAY = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris" })

const ADDRESS = {
  firstName: "Test",
  lastName: "Client",
  line1: "1 rue de Test",
  line2: null,
  postal: "75001",
  city: "Paris",
  country: "FR",
  phone: null,
}

describe("beneficiary payouts (story 11.10)", () => {
  let app: FastifyInstance
  let adminToken: string
  let customerToken: string
  let customerId: string
  let beneficiaryId: string
  let variantId: string
  let orderId: string

  async function cleanup() {
    const userIds = db.select({ id: users.id }).from(users).where(like(users.email, "testpayout-%"))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
    const orderIds = db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, userIds))
    await db.delete(refunds).where(inArray(refunds.orderId, orderIds))
    await db.delete(henrriDocuments).where(inArray(henrriDocuments.orderId, orderIds))
    await db.delete(beneficiaryPayouts).where(inArray(beneficiaryPayouts.orderId, orderIds))
    await db.delete(orders).where(inArray(orders.userId, userIds))
    await db.delete(users).where(like(users.email, "testpayout-%"))
    await db.delete(products).where(like(products.sku, `${PREFIX}%`))
    await db.delete(beneficiaries).where(like(beneficiaries.slug, "testpayout-%"))
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
    const login = await signIn(app, { email, password: PASSWORD })
    return { id: row?.id as string, token: login.json().accessToken as string }
  }

  const asAdmin = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${adminToken}` }, ...(body ? { payload: body } : {}) })

  /** One placed order carrying one line of the beneficiary's article. */
  async function placeOrder(priceHt: number, qty = 1) {
    const totalTtc = priceHt * qty * 1.2
    const [order] = await db
      .insert(orders)
      .values({
        userId: customerId,
        paymentStatus: "pending",
        itemsJson: [
          {
            variantId,
            qty,
            priceHt,
            name: "Article de test",
            sku: `${PREFIX}1`,
            category: "arme-longue",
            requiresPaymentVirement: false,
          },
        ],
        subtotalHt: (priceHt * qty).toFixed(2),
        vatAmount: (priceHt * qty * 0.2).toFixed(2),
        totalTtc: totalTtc.toFixed(2),
        shippingAddress: ADDRESS,
        billingAddress: ADDRESS,
      })
      .returning({ id: orders.id })
    if (!order) throw new Error("Order insert returned no row")

    await createPayoutsForOrder(order.id, [{ variantId, qty, priceHt, name: "Article de test" }])
    return order.id
  }

  const payoutsOf = (id: string) => db.select().from(beneficiaryPayouts).where(eq(beneficiaryPayouts.orderId, id))

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()

    const admin = await makeUser(ADMIN_EMAIL, "admin")
    adminToken = admin.token
    const customer = await makeUser(CUSTOMER_EMAIL, "customer")
    customerToken = customer.token
    customerId = customer.id

    const [category] = await db
      .select({ id: productCategories.id })
      .from(productCategories)
      .where(eq(productCategories.slug, "arme-longue"))
      .limit(1)
    const [legal] = await db
      .select({ id: legalCategories.id })
      .from(legalCategories)
      .where(eq(legalCategories.category, "none"))
      .limit(1)
    if (!category || !legal) throw new Error("Missing seeded reference data (run db:seed)")

    const [beneficiary] = await db
      .insert(beneficiaries)
      .values({ slug: "testpayout-flo", name: "Florian de test", kind: "advisor", defaultSharePct: "10.00" })
      .returning({ id: beneficiaries.id })
    if (!beneficiary) throw new Error("Beneficiary insert returned no row")
    beneficiaryId = beneficiary.id

    const [product] = await db
      .insert(products)
      .values({
        sku: `${PREFIX}1`,
        slug: `${PREFIX.toLowerCase()}1`,
        name: "Article de test",
        categoryId: category.id,
        legalCategoryId: legal.id,
        priceHt: "1000.00",
        requiresLegalVerification: false,
        published: true,
        beneficiaryId,
      })
      .returning({ id: products.id })
    if (!product) throw new Error("Product insert returned no row")

    const [variant] = await db
      .insert(productVariants)
      .values({ productId: product.id, skuVariant: `${PREFIX}1-A`, finition: "Standard", stockQty: 10 })
      .returning({ id: productVariants.id })
    if (!variant) throw new Error("Variant insert returned no row")
    variantId = variant.id
  })

  beforeEach(async () => {
    const userOrders = db.select({ id: orders.id }).from(orders).where(eq(orders.userId, customerId))
    await db.delete(refunds).where(inArray(refunds.orderId, userOrders))
    await db.delete(henrriDocuments).where(inArray(henrriDocuments.orderId, userOrders))
    await db.delete(beneficiaryPayouts).where(inArray(beneficiaryPayouts.orderId, userOrders))
    await db.delete(orders).where(eq(orders.userId, customerId))
    orderId = await placeOrder(1000)
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it("refuses anyone but an admin", async () => {
    expect((await app.inject({ method: "GET", url: `${BASE}/beneficiaries` })).statusCode).toBe(401)
    const asCustomer = await app.inject({
      method: "GET",
      url: `${BASE}/payouts`,
      headers: { authorization: `Bearer ${customerToken}` },
    })
    expect(asCustomer.statusCode).toBe(403)
  })

  it("records what will be owed, as pending — an unpaid order owes nothing", async () => {
    const rows = await payoutsOf(orderId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: "pending", sharePct: "10.00", baseHt: "1000.00", amountHt: "100.00" })
  })

  it("makes it due once the money has landed", async () => {
    await db.update(orders).set({ paymentStatus: "received" }).where(eq(orders.id, orderId))
    await settlePayoutsForOrder(orderId)

    const rows = await payoutsOf(orderId)
    expect(rows[0]?.status).toBe("due")
    expect(rows[0]?.amountHt).toBe("100.00")
  })

  /**
   * The basis is HT and net of refunds: VAT is not revenue, and money returned
   * to the customer is not money the beneficiary earned.
   */
  it("reduces the share in proportion to a partial refund", async () => {
    await db.update(orders).set({ paymentStatus: "received" }).where(eq(orders.id, orderId))
    await settlePayoutsForOrder(orderId)

    // 300 € TTC refunded out of 1200 → a quarter gone, three quarters left.
    await db.insert(refunds).values({ orderId, channel: "carte", amountTtc: "300.00", status: "succeeded" })
    await db.update(orders).set({ paymentStatus: "partially_refunded" }).where(eq(orders.id, orderId))
    await settlePayoutsForOrder(orderId)

    const rows = await payoutsOf(orderId)
    expect(rows[0]?.amountHt).toBe("75.00")
    expect(rows[0]?.status).toBe("due")
  })

  it("owes nothing at all once the sale is fully refunded", async () => {
    await db.update(orders).set({ paymentStatus: "received" }).where(eq(orders.id, orderId))
    await settlePayoutsForOrder(orderId)

    await db.insert(refunds).values({ orderId, channel: "carte", amountTtc: "1200.00", status: "succeeded" })
    await db.update(orders).set({ paymentStatus: "refunded" }).where(eq(orders.id, orderId))
    await settlePayoutsForOrder(orderId)

    const rows = await payoutsOf(orderId)
    expect(rows[0]?.status).toBe("cancelled")
    expect(rows[0]?.amountHt).toBe("0.00")
  })

  /**
   * The heart of the story: renegotiating a rate must never rewrite what was
   * owed on a sale that already happened.
   */
  it("freezes the rate at the sale, so a later renegotiation is not retroactive", async () => {
    await db.update(orders).set({ paymentStatus: "received" }).where(eq(orders.id, orderId))
    await settlePayoutsForOrder(orderId)

    const res = await asAdmin("PATCH", `${BASE}/beneficiaries/${beneficiaryId}`, { defaultSharePct: 50 })
    expect(res.statusCode).toBe(200)
    await settlePayoutsForOrder(orderId)

    const rows = await payoutsOf(orderId)
    expect(rows[0]?.sharePct).toBe("10.00")
    expect(rows[0]?.amountHt).toBe("100.00")

    // …but a NEW sale is priced at the new rate.
    const freshOrderId = await placeOrder(1000)
    const fresh = await payoutsOf(freshOrderId)
    expect(fresh[0]?.sharePct).toBe("50.00")

    await asAdmin("PATCH", `${BASE}/beneficiaries/${beneficiaryId}`, { defaultSharePct: 10 })
  })

  it("never touches a payout the admin has already settled", async () => {
    await db.update(orders).set({ paymentStatus: "received" }).where(eq(orders.id, orderId))
    await settlePayoutsForOrder(orderId)
    const [row] = await payoutsOf(orderId)

    const paid = await asAdmin("PATCH", `${BASE}/payouts/${row?.id}`, {
      status: "paid",
      paidNotes: "Virement du 10/09",
    })
    expect(paid.statusCode).toBe(200)
    expect(paid.json().data.paidAt).not.toBeNull()

    // A refund arrives afterwards: money already out is a fact, not a projection.
    await db.insert(refunds).values({ orderId, channel: "carte", amountTtc: "1200.00", status: "succeeded" })
    await db.update(orders).set({ paymentStatus: "refunded" }).where(eq(orders.id, orderId))
    await settlePayoutsForOrder(orderId)

    const after = await payoutsOf(orderId)
    expect(after[0]?.status).toBe("paid")
    expect(after[0]?.amountHt).toBe("100.00")
  })

  it("refuses to settle a payout on a sale that was never paid", async () => {
    const [row] = await payoutsOf(orderId)
    const res = await asAdmin("PATCH", `${BASE}/payouts/${row?.id}`, { status: "paid" })
    expect(res.statusCode).toBe(409)
    expect(res.json().message).toContain("not paid")
  })

  it("totals what is owed and what was paid, per beneficiary", async () => {
    await db.update(orders).set({ paymentStatus: "received" }).where(eq(orders.id, orderId))
    await settlePayoutsForOrder(orderId)

    const rows = (await asAdmin("GET", `${BASE}/beneficiaries`)).json().data as Array<{
      id: string
      dueHt: number
      paidHt: number
    }>
    const mine = rows.find((b) => b.id === beneficiaryId)
    expect(mine?.dueHt).toBe(100)
    expect(mine?.paidHt).toBe(0)
  })

  it("filters the payout list by beneficiary and by status", async () => {
    const all = (await asAdmin("GET", `${BASE}/payouts?beneficiaryId=${beneficiaryId}`)).json().data
    expect(all.length).toBeGreaterThanOrEqual(1)
    const due = (await asAdmin("GET", `${BASE}/payouts?beneficiaryId=${beneficiaryId}&status=due`)).json().data
    expect(due).toHaveLength(0) // this order is still pending
  })

  /** A payout trail is accounting: it must not vanish with a contact. */
  it("refuses to delete a beneficiary who appears on a sale, and says what to do instead", async () => {
    const res = await asAdmin("DELETE", `${BASE}/beneficiaries/${beneficiaryId}`)
    expect(res.statusCode).toBe(409)
    expect(res.json().message).toContain("deactivate")
  })

  it("creates no payout at all for an article nobody is owed on", async () => {
    await db
      .update(products)
      .set({ beneficiaryId: null })
      .where(like(products.sku, `${PREFIX}%`))
    const freshOrderId = await placeOrder(500)
    // An absent row is clearer than a row worth zero.
    expect(await payoutsOf(freshOrderId)).toHaveLength(0)
    await db
      .update(products)
      .set({ beneficiaryId })
      .where(like(products.sku, `${PREFIX}%`))
  })

  it("journals settling a payout and putting it back, in the order's history", async () => {
    await db.update(orders).set({ paymentStatus: "received" }).where(eq(orders.id, orderId))
    await settlePayoutsForOrder(orderId)
    const [row] = await payoutsOf(orderId)

    await asAdmin("PATCH", `${BASE}/payouts/${row?.id}`, { status: "paid", paidNotes: "Virement du 10/09" })
    await asAdmin("PATCH", `${BASE}/payouts/${row?.id}`, { status: "due" })

    const events = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, row?.id as string))
      .orderBy(auditLogs.createdAt)
    expect(events.map((event) => event.action)).toEqual(["payout.paid", "payout.unpaid"])
    expect(events[0]).toMatchObject({
      entityType: "payout",
      orderId,
      userRole: "admin",
      oldValue: { status: "due" },
      newValue: { status: "paid", amountHt: "100.00", beneficiary: "Florian de test", paidNotes: "Virement du 10/09" },
    })
  })

  describe("accounting export, by the day the money went out", () => {
    /** A paid sale whose payout was settled at `paidAt`, with its Henrri invoice when numbered. */
    async function settledAt(paidAt: string, invoiceNumber?: string) {
      const id = await placeOrder(1000)
      await db.update(orders).set({ paymentStatus: "received" }).where(eq(orders.id, id))
      await settlePayoutsForOrder(id)
      await db
        .update(beneficiaryPayouts)
        .set({ status: "paid", paidAt: new Date(paidAt), paidNotes: "Virement ; septembre" })
        .where(eq(beneficiaryPayouts.orderId, id))
      if (invoiceNumber) {
        await db.insert(henrriDocuments).values({
          orderId: id,
          kind: "invoice",
          status: "finalized",
          henrriNumber: invoiceNumber,
          expectedTotalTtc: "1200.00",
        })
      }
      return id
    }

    const exportOf = (query: string) => asAdmin("GET", `${BASE}/payouts/export?${query}`)

    it("lists the payouts settled in the period, Paris days, as a French Excel CSV", async () => {
      const invoiceNumber = `T-${Date.now() % 1e9}`
      const inSeptember = await settledAt("2026-09-15T10:00:00Z", invoiceNumber)
      // 00:30 on 1 October in Paris: October's books, not September's.
      const firstOfOctober = await settledAt("2026-09-30T22:30:00Z")

      const res = await exportOf(`from=2026-09-01&to=2026-09-30&beneficiaryId=${beneficiaryId}`)

      expect(res.statusCode).toBe(200)
      expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8")
      expect(res.headers["content-disposition"]).toBe('attachment; filename="reversements-2026-09-01-2026-09-30.csv"')
      expect(res.headers["cache-control"]).toBe("no-store")
      expect(res.body.startsWith("\uFEFF")).toBe(true)
      const lines = res.body.slice(1).trimEnd().split("\r\n")
      expect(lines[0]).toBe(
        "Versé le;Bénéficiaire;Commande;Date de commande;Facture;Article;Base HT;Taux (%);Montant HT;Note",
      )
      expect(lines).toHaveLength(2)
      expect(lines[1]).toBe(
        `15/09/2026;Florian de test;${orderReference(inSeptember)};${PARIS_DAY.format(new Date())};${invoiceNumber};Article de test;1000,00;10,00;100,00;"Virement ; septembre"`,
      )

      const october = (await exportOf(`from=2026-10-01&to=2026-10-31&beneficiaryId=${beneficiaryId}`)).body
      expect(october).toContain(orderReference(firstOfOctober))
      expect(october).not.toContain(orderReference(inSeptember))
    })

    it("leaves out what is still owed, and keeps the header when nothing was paid", async () => {
      await db.update(orders).set({ paymentStatus: "received" }).where(eq(orders.id, orderId))
      await settlePayoutsForOrder(orderId)

      const res = await exportOf(`from=2000-01-01&to=2099-12-31&beneficiaryId=${beneficiaryId}`)
      expect(res.statusCode).toBe(200)
      expect(res.body.slice(1).trimEnd().split("\r\n")).toHaveLength(1)
    })

    it("sums the period per beneficiary next to what is still owed and to come", async () => {
      await settledAt("2026-08-10T10:00:00Z")
      await settledAt("2026-08-20T10:00:00Z")
      await db.update(orders).set({ paymentStatus: "received" }).where(eq(orders.id, orderId))
      await settlePayoutsForOrder(orderId)
      await placeOrder(500)

      const res = await asAdmin("GET", `${BASE}/payouts/summary?from=2026-08-01&to=2026-08-31`)

      expect(res.statusCode).toBe(200)
      const mine = res.json().data.find((row: { beneficiaryId: string }) => row.beneficiaryId === beneficiaryId)
      expect(mine).toEqual({
        beneficiaryId,
        name: "Florian de test",
        paidCount: 2,
        paidHt: 200,
        dueHt: 100,
        pendingHt: 50,
      })
    })

    it("refuses a reversed or incomplete period", async () => {
      expect((await exportOf("from=2026-09-30&to=2026-09-01")).statusCode).toBe(400)
      expect((await asAdmin("GET", `${BASE}/payouts/summary?from=2026-09-01`)).statusCode).toBe(400)
    })
  })
})
