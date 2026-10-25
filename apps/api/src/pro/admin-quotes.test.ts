import { DEFAULT_QUOTE_VALIDITY_DAYS, parisToday } from "@armurier/shared"
import { eq, inArray } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, henrriDocuments, legalDocuments, organisations, quoteRequests } from "../db/schema.js"
import { type Account, type FixtureProduct, proFixtures } from "../test/pro-fixtures.js"
import { purgeStaleQuoteRequests } from "./retention.js"

vi.mock("../email.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../email.js")>()),
  sendQuoteRequestReceivedEmail: vi.fn().mockResolvedValue(undefined),
  sendQuoteRequestAlertEmail: vi.fn().mockResolvedValue(undefined),
}))

const TAG = "adminquote"

describe("quote requests in the back-office (story 12.8c)", () => {
  let app: FastifyInstance
  let fixtures: ReturnType<typeof proFixtures>
  let pro: Account
  let admin: Account
  let rifle: FixtureProduct

  const asAdmin = (method: "GET" | "POST" | "PATCH", url: string, token = admin.token, payload?: object) =>
    app.inject({
      method,
      url: `/api/admin/quote-requests${url}`,
      headers: { authorization: `Bearer ${token}` },
      ...(payload && { payload }),
    })
  const patch = (id: string, payload: object) => asAdmin("PATCH", `/${id}`, admin.token, payload)

  async function requestOf(qty = 2) {
    const headers = { authorization: `Bearer ${pro.token}` }
    await app.inject({
      method: "POST",
      url: "/api/pro/quote-basket/items",
      headers,
      payload: { variantId: rifle.variantId, qty },
    })
    const res = await app.inject({ method: "POST", url: "/api/pro/quote-requests", headers, payload: {} })
    return res.json().data as { id: string; number: string }
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    fixtures = proFixtures(app, TAG)
    await fixtures.cleanup()
    pro = await fixtures.account({ organisation: "approved" })
    admin = await fixtures.account({ role: "admin" })
    rifle = await fixtures.product("rifle", { categorySlug: "arme-longue", legalCategory: "C", priceHt: 1200 })
  })

  afterAll(async () => {
    await fixtures.cleanup()
    await app.close()
  })

  it("is for admins only", async () => {
    expect((await asAdmin("GET", "", pro.token)).statusCode).toBe(403)
  })

  it("lists the requests by status, with their organisation and requester", async () => {
    const request = await requestOf()

    const res = await asAdmin("GET", "?status=requested&limit=100")

    expect(res.statusCode).toBe(200)
    const row = res.json().data.find((candidate: { id: string }) => candidate.id === request.id)
    expect(row).toMatchObject({
      number: request.number,
      status: "requested",
      lineCount: 1,
      organisation: { legalName: `Armurerie ${TAG}` },
      requester: { email: pro.email },
    })
  })

  it("shows a request with its frozen public prices and the organisation's terms", async () => {
    const request = await requestOf(3)

    const detail = (await asAdmin("GET", `/${request.id}`)).json().data

    expect(detail.items[0]).toMatchObject({ qty: 3, publicPriceHt: 1205, vatPct: 20, legalCategory: "C" })
    expect(detail.organisation).toMatchObject({ discountPct: 0, net30Allowed: false, showPrices: false })
    expect((await asAdmin("GET", `/${crypto.randomUUID()}`)).statusCode).toBe(404)
  })

  it("takes a request in hand, which closes it to cancellation", async () => {
    const request = await requestOf()

    const res = await asAdmin("POST", `/${request.id}/review`)
    expect(res.statusCode).toBe(200)
    expect(res.json().data.status).toBe("in_review")
    expect((await asAdmin("POST", `/${request.id}/review`)).statusCode).toBe(409)

    const events = await db.select().from(auditLogs).where(eq(auditLogs.entityId, request.id))
    expect(events.map((event) => event.action)).toContain("quote_request.in_review")

    const cancel = await app.inject({
      method: "POST",
      url: `/api/pro/quote-requests/${request.id}/cancel`,
      headers: { authorization: `Bearer ${pro.token}` },
    })
    expect(cancel.statusCode).toBe(409)
  })

  describe("quoting a request (story 12.8d)", () => {
    const inDays = (days: number) => parisToday(new Date(Date.now() + days * 24 * 60 * 60 * 1000))

    async function setOrganisation(values: Partial<typeof organisations.$inferInsert>) {
      await db
        .update(organisations)
        .set(values)
        .where(eq(organisations.id, pro.organisationId as string))
    }

    async function inReview(qty = 2) {
      const request = await requestOf(qty)
      await asAdmin("POST", `/${request.id}/review`)
      return request
    }

    beforeAll(async () => {
      await setOrganisation({ discountPct: "10.00" })
    })

    afterAll(async () => {
      await setOrganisation({ discountPct: "0.00", billingLine1: null, billingPostal: null, billingCity: null })
    })

    it("starts the quote when SCS takes the request in hand: discounted prices, the grid's delivery, 30 days", async () => {
      const request = await inReview(3)

      const quote = (await asAdmin("GET", `/${request.id}`)).json().data

      expect(quote.items[0]).toMatchObject({ publicPriceHt: 1205, quotedPriceHt: 1084.5, lineDiscountPct: 10 })
      // A long gun travels one parcel per unit at the grid's firearm rate (25 € TTC).
      expect(quote.shippingTtc).toBe(75)
      expect(quote.totals).toEqual({ totalHt: 3316, vatAmount: 663.2, totalTtc: 3979.2 })
      expect(quote.validUntil).toBe(inDays(DEFAULT_QUOTE_VALIDITY_DAYS))
      expect(quote).toMatchObject({ requiresDocuments: true, documentsSufficient: null, henrri: null, sending: false })
    })

    it("prices a line by discount or by price, and types the delivery by hand", async () => {
      const request = await inReview(3)
      const { items } = (await asAdmin("GET", `/${request.id}`)).json().data

      const byDiscount = await patch(request.id, { items: [{ id: items[0].id, discountPct: 20 }], shippingTtc: 30 })
      expect(byDiscount.statusCode).toBe(200)
      expect(byDiscount.json().data.items[0]).toMatchObject({ quotedPriceHt: 964, lineDiscountPct: 20 })
      expect(byDiscount.json().data.shippingTtc).toBe(30)

      const byPrice = (await patch(request.id, { items: [{ id: items[0].id, unitPriceHt: 1000 }] })).json().data
      expect(byPrice.items[0]).toMatchObject({ quotedPriceHt: 1000, lineDiscountPct: 17.01 })
      expect(byPrice.totals.totalTtc).toBe(3630)

      const events = await db.select().from(auditLogs).where(eq(auditLogs.entityId, request.id))
      expect(events.filter((event) => event.action === "quote_request.updated")).toHaveLength(2)
    })

    it("shows SCS the organisation's documents, to judge them", async () => {
      const request = await inReview()
      const [document] = await db
        .insert(legalDocuments)
        .values({
          organisationId: pro.organisationId,
          docType: "agrement_armurier",
          s3Key: "legal-documents/organisations/x/test.pdf",
          s3Url: "memory://x",
          scanStatus: "clean",
          verificationStatus: "approved",
          expiresAt: "2030-12-31",
        })
        .returning({ id: legalDocuments.id })

      const quote = (await asAdmin("GET", `/${request.id}`)).json().data

      expect(quote.organisationDocuments).toContainEqual({
        id: document.id,
        docType: "agrement_armurier",
        verificationStatus: "approved",
        expiresAt: "2030-12-31",
      })
      await db.delete(legalDocuments).where(eq(legalDocuments.id, document.id))
    })

    it("records who judged the organisation's documents sufficient, and when", async () => {
      const request = await inReview()

      const judged = (await patch(request.id, { documentsSufficient: true })).json().data
      expect(judged.documentsSufficient).toMatchObject({ by: admin.id })
      expect(judged.documentsSufficient.at).toEqual(expect.any(String))

      expect((await patch(request.id, { documentsSufficient: false })).json().data.documentsSufficient).toBeNull()
    })

    it("refuses a line of another request, a validity already past and a request not in review", async () => {
      const request = await inReview()
      const other = await inReview()
      const { items } = (await asAdmin("GET", `/${other.id}`)).json().data

      expect((await patch(request.id, { items: [{ id: items[0].id, discountPct: 5 }] })).statusCode).toBe(400)
      expect((await patch(request.id, { validUntil: inDays(-1) })).statusCode).toBe(400)

      const untouched = await requestOf()
      const refused = await patch(untouched.id, { shippingTtc: 10 })
      expect(refused.statusCode).toBe(409)
      expect(refused.json().error).toBe("InvalidStatusTransition")
    })

    describe("POST /:id/send", () => {
      it("needs the organisation's billing address", async () => {
        const request = await inReview()

        const res = await asAdmin("POST", `/${request.id}/send`)

        expect(res.statusCode).toBe(409)
        expect(res.json().error).toBe("MissingBillingAddress")
      })

      it("freezes the total, queues the Henrri quote and locks the quote while it goes out", async () => {
        await setOrganisation({ billingLine1: "12 rue de la Paix", billingPostal: "75002", billingCity: "Paris" })
        const request = await inReview(3)

        const res = await asAdmin("POST", `/${request.id}/send`)

        expect(res.statusCode).toBe(202)
        expect(res.json().data).toMatchObject({ sending: true, henrri: { status: "pending" } })
        const [stored] = await db.select().from(quoteRequests).where(eq(quoteRequests.id, request.id))
        expect(stored.totalTtc).toBe("3979.20")
        const [document] = await db.select().from(henrriDocuments).where(eq(henrriDocuments.quoteRequestId, request.id))
        expect(document).toMatchObject({ kind: "quotation", status: "pending", expectedTotalTtc: "3979.20" })

        const locked = await patch(request.id, { shippingTtc: 0 })
        expect(locked.statusCode).toBe(409)
        expect(locked.json().error).toBe("QuoteSending")
        expect((await asAdmin("POST", `/${request.id}/send`)).statusCode).toBe(409)

        const events = await db.select().from(auditLogs).where(eq(auditLogs.entityId, request.id))
        expect(events.map((event) => event.action)).toContain("quote_request.send_requested")
      })

      it("refuses a quote whose validity has passed", async () => {
        await setOrganisation({ billingLine1: "12 rue de la Paix", billingPostal: "75002", billingCity: "Paris" })
        const request = await inReview()
        await db
          .update(quoteRequests)
          .set({ validUntil: new Date("2020-01-01T00:00:00Z") })
          .where(eq(quoteRequests.id, request.id))

        const res = await asAdmin("POST", `/${request.id}/send`)

        expect(res.statusCode).toBe(409)
        expect(res.json().error).toBe("QuoteExpired")
      })
    })
  })

  describe("retention: 3 years after the last activity, unless converted (decision 2026-10-21)", () => {
    it("purges an old request that never became an order, keeps a converted one and a recent one", async () => {
      const old = await requestOf()
      const converted = await requestOf()
      const recent = await requestOf()
      const fourYearsAgo = new Date(Date.now() - 4 * 365 * 24 * 60 * 60 * 1000)
      await db
        .update(quoteRequests)
        .set({ updatedAt: fourYearsAgo, status: "declined" })
        .where(eq(quoteRequests.id, old.id))
      await db
        .update(quoteRequests)
        .set({ updatedAt: fourYearsAgo, status: "converted" })
        .where(eq(quoteRequests.id, converted.id))

      const removed = await purgeStaleQuoteRequests()

      expect(removed.quoteRequests).toBeGreaterThanOrEqual(1)
      const left = await db
        .select({ id: quoteRequests.id })
        .from(quoteRequests)
        .where(inArray(quoteRequests.id, [old.id, converted.id, recent.id]))
      expect(left.map((row) => row.id).sort()).toEqual([converted.id, recent.id].sort())
    })
  })
})
