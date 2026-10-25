import { CURRENT_TERMS_VERSION } from "@armurier/shared"
import { eq, inArray } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import {
  addresses,
  auditLogs,
  henrriDocuments,
  orders,
  organisations,
  paymentCarte,
  paymentVirement,
  productVariants,
  quoteRequests,
} from "../db/schema.js"
import { type Account, type FixtureProduct, proFixtures } from "../test/pro-fixtures.js"
import { validityDate } from "./quotes.js"

vi.mock("../email.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../email.js")>()),
  sendQuoteRequestReceivedEmail: vi.fn().mockResolvedValue(undefined),
  sendQuoteRequestAlertEmail: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("../orders/confirmation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../orders/confirmation.js")>()),
  sendOrderConfirmation: vi.fn().mockResolvedValue(undefined),
}))

const TAG = "quoteaccept"
const DAY_MS = 24 * 60 * 60 * 1000

describe("accepting a quote (story 12.8d)", () => {
  let app: FastifyInstance
  let fixtures: ReturnType<typeof proFixtures>
  let pro: Account
  let otherPro: Account
  let admin: Account
  let rifle: FixtureProduct
  let sling: FixtureProduct
  let addressId: string
  let counter = 0

  const call = (method: "GET" | "POST" | "PATCH", url: string, token: string, payload?: object) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload && { payload }) })

  const accept = (id: string, body: object = {}, token = pro.token) =>
    call("POST", `/api/pro/quote-requests/${id}/accept`, token, {
      shippingAddressId: addressId,
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
      ...body,
    })

  /** A quote SCS has priced, judged and sent: 2 rifles (category C) at 1 084,50 € HT. */
  async function sentQuote(
    options: { product?: FixtureProduct; qty?: number; documentsSufficient?: boolean; validDays?: number } = {},
  ) {
    const headers = { authorization: `Bearer ${pro.token}` }
    await app.inject({
      method: "POST",
      url: "/api/pro/quote-basket/items",
      headers,
      payload: { variantId: (options.product ?? rifle).variantId, qty: options.qty ?? 2 },
    })
    const request = (await call("POST", "/api/pro/quote-requests", pro.token)).json().data as {
      id: string
      number: string
    }
    await call("POST", `/api/admin/quote-requests/${request.id}/review`, admin.token)
    if (options.documentsSufficient ?? true) {
      await call("PATCH", `/api/admin/quote-requests/${request.id}`, admin.token, { documentsSufficient: true })
    }
    const view = (await call("GET", `/api/admin/quote-requests/${request.id}`, admin.token)).json().data
    counter += 1
    await db
      .update(quoteRequests)
      .set({
        status: "sent",
        sentAt: new Date(),
        totalTtc: view.totals.totalTtc.toFixed(2),
        validUntil: validityDate(new Date(Date.now() + (options.validDays ?? 10) * DAY_MS).toISOString().slice(0, 10)),
      })
      .where(eq(quoteRequests.id, request.id))
    await db.insert(henrriDocuments).values({
      quoteRequestId: request.id,
      kind: "quotation",
      status: "finalized",
      henrriDocumentId: 900_000 + counter,
      henrriNumber: `QA-${Date.now() % 1e6}-${counter}`,
      expectedTotalTtc: view.totals.totalTtc.toFixed(2),
      finalizedAt: new Date(),
      customerNotifiedAt: new Date(),
    })
    return { ...request, totalTtc: view.totals.totalTtc as number }
  }

  const stockOf = async (product: FixtureProduct) =>
    (await db.select().from(productVariants).where(eq(productVariants.id, product.variantId)))[0]?.stockQty
  const requestOf = async (id: string) => (await db.select().from(quoteRequests).where(eq(quoteRequests.id, id)))[0]

  async function setOrganisation(values: Partial<typeof organisations.$inferInsert>) {
    await db
      .update(organisations)
      .set(values)
      .where(eq(organisations.id, pro.organisationId as string))
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    fixtures = proFixtures(app, TAG)
    await fixtures.cleanup()
    pro = await fixtures.account({ organisation: "approved" })
    otherPro = await fixtures.account({ organisation: "approved" })
    admin = await fixtures.account({ role: "admin" })
    rifle = await fixtures.product("rifle", { categorySlug: "arme-longue", legalCategory: "C", priceHt: 1200 })
    sling = await fixtures.product("sling", { categorySlug: "accessoire-tireur", legalCategory: "none", priceHt: 20 })
    await setOrganisation({
      discountPct: "10.00",
      billingLine1: "12 rue de la Paix",
      billingPostal: "75002",
      billingCity: "Paris",
    })
    const [address] = await db
      .insert(addresses)
      .values({
        userId: pro.id,
        firstName: "Jeanne",
        lastName: "Armand",
        line1: "3 quai du Stand",
        postal: "69002",
        city: "Lyon",
        country: "FR",
      })
      .returning({ id: addresses.id })
    addressId = address.id
  })

  beforeEach(async () => {
    await setOrganisation({ net30Allowed: false })
  })

  afterAll(async () => {
    const userIds = [pro.id, otherPro.id]
    const orderIds = db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, userIds))
    await db.delete(auditLogs).where(inArray(auditLogs.orderId, orderIds))
    await db.delete(auditLogs).where(inArray(auditLogs.entityId, orderIds))
    await db.delete(paymentCarte).where(inArray(paymentCarte.orderId, orderIds))
    await db.delete(paymentVirement).where(inArray(paymentVirement.orderId, orderIds))
    await db.delete(orders).where(inArray(orders.userId, userIds))
    await db.delete(addresses).where(inArray(addresses.userId, userIds))
    await fixtures.cleanup()
    await app.close()
  })

  it("turns the quote into an order at its prices, billed to the organisation, shipped where the pro says", async () => {
    const quote = await sentQuote()
    const stockBefore = await stockOf(rifle)

    const res = await accept(quote.id, { chorusServiceCode: "SRV-42", chorusCommitmentNumber: "EJ-2026-118" })

    expect(res.statusCode).toBe(201)
    const orderId = res.json().data.id as string
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId))
    expect(order).toMatchObject({
      userId: pro.id,
      quoteRequestId: quote.id,
      paymentTerms: "immediate",
      paymentStatus: "pending",
      legalVerificationStatus: "docs_verified",
      totalTtc: quote.totalTtc.toFixed(2),
      vipDiscountAmount: "0.00",
      chorusServiceCode: "SRV-42",
      chorusCommitmentNumber: "EJ-2026-118",
      termsVersion: CURRENT_TERMS_VERSION,
    })
    expect(order?.itemsJson[0]).toMatchObject({
      variantId: rifle.variantId,
      qty: 2,
      priceHt: 1084.5,
      sku: rifle.sku,
      legalCategory: "C",
      requiresPaymentVirement: true,
      vatPct: 20,
      discountHt: 0,
    })
    expect(order?.shippingPortions?.length).toBeGreaterThan(0)
    expect(order?.billingAddress).toMatchObject({ line1: "12 rue de la Paix", postal: "75002", city: "Paris" })
    expect(order?.shippingAddress).toMatchObject({ line1: "3 quai du Stand", city: "Lyon" })
    expect(await stockOf(rifle)).toBe((stockBefore ?? 0) - 2)

    // A category C firearm is paid by transfer, delivery included.
    const [transfer] = await db.select().from(paymentVirement).where(eq(paymentVirement.orderId, orderId))
    expect(transfer?.amountExpectedTtc).toBe(quote.totalTtc.toFixed(2))
    expect(await db.select().from(paymentCarte).where(eq(paymentCarte.orderId, orderId))).toHaveLength(0)

    const accepted = await requestOf(quote.id)
    expect(accepted).toMatchObject({ status: "converted", acceptedBy: pro.id })
    expect(accepted?.acceptedAt).toBeInstanceOf(Date)
    expect(accepted?.acceptedIp).toEqual(expect.any(String))
    const events = await db.select().from(auditLogs).where(eq(auditLogs.entityId, quote.id))
    expect(events.map((event) => event.action)).toContain("quote_request.accepted")
  })

  it("leaves an organisation on invoice the whole amount to pay by transfer, 30 days after the invoice", async () => {
    await setOrganisation({ net30Allowed: true })
    const quote = await sentQuote({ product: sling, documentsSufficient: false })

    const res = await accept(quote.id)

    expect(res.statusCode).toBe(201)
    const [order] = await db.select().from(orders).where(eq(orders.id, res.json().data.id))
    expect(order).toMatchObject({
      paymentTerms: "net30",
      legalVerificationStatus: "payment_pending",
      paymentDueAt: null,
    })
    const [transfer] = await db
      .select()
      .from(paymentVirement)
      .where(eq(paymentVirement.orderId, order?.id as string))
    expect(transfer?.amountExpectedTtc).toBe(quote.totalTtc.toFixed(2))
  })

  it("asks for the organisation's documents to be judged first when a line is of category A, B or C", async () => {
    const quote = await sentQuote({ documentsSufficient: false })

    const res = await accept(quote.id)

    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe("DocumentsRequired")
    expect((await requestOf(quote.id))?.status).toBe("sent")
  })

  it("refuses a quote whose validity has passed, or that is not out yet", async () => {
    const expired = await sentQuote({ validDays: -2 })
    const refused = await accept(expired.id)
    expect(refused.statusCode).toBe(409)
    expect(refused.json().error).toBe("QuoteExpired")

    const once = await sentQuote()
    expect((await accept(once.id)).statusCode).toBe(201)
    const twice = await accept(once.id)
    expect(twice.statusCode).toBe(409)
    expect(twice.json().error).toBe("InvalidStatusTransition")
  })

  it("refuses when the stock no longer covers the quote, and changes nothing", async () => {
    const quote = await sentQuote({ qty: 3 })
    await db.update(productVariants).set({ stockQty: 1 }).where(eq(productVariants.id, rifle.variantId))

    const res = await accept(quote.id)

    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe("InsufficientStock")
    expect(await stockOf(rifle)).toBe(1)
    expect((await requestOf(quote.id))?.status).toBe("sent")
    expect(await db.select().from(orders).where(eq(orders.quoteRequestId, quote.id))).toHaveLength(0)
    await db.update(productVariants).set({ stockQty: 10 }).where(eq(productVariants.id, rifle.variantId))
  })

  it("refuses an address outside metropolitan France, someone else's address, and outdated terms", async () => {
    const quote = await sentQuote()
    const [abroad] = await db
      .insert(addresses)
      .values({ userId: pro.id, firstName: "J", lastName: "A", line1: "1 rue", postal: "97400", city: "Saint-Denis" })
      .returning({ id: addresses.id })
    const [foreign] = await db
      .insert(addresses)
      .values({ userId: otherPro.id, firstName: "P", lastName: "B", line1: "2 rue", postal: "75001", city: "Paris" })
      .returning({ id: addresses.id })

    expect((await accept(quote.id, { shippingAddressId: abroad.id })).statusCode).toBe(422)
    expect((await accept(quote.id, { shippingAddressId: foreign.id })).statusCode).toBe(404)
    const stale = await accept(quote.id, { acceptedTermsVersion: "2020-01-01" })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().error).toBe("TermsOutdated")
    expect((await accept(quote.id, {}, otherPro.token)).statusCode).toBe(404)
    expect((await requestOf(quote.id))?.status).toBe("sent")
  })
})
