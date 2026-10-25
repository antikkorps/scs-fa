import { parisToday } from "@armurier/shared"
import { eq } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, henrriDocuments, organisations, quoteRequests } from "../db/schema.js"
import { createFakeHenrri, FAKE_TYPES } from "../test/henrri-fake.js"
import { type Account, type FixtureProduct, proFixtures } from "../test/pro-fixtures.js"
import { expireQuotes } from "./quote-expiry.js"
import { validityDate } from "./quotes.js"

vi.mock("../email.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../email.js")>()),
  sendQuoteRequestReceivedEmail: vi.fn().mockResolvedValue(undefined),
  sendQuoteRequestAlertEmail: vi.fn().mockResolvedValue(undefined),
}))

const TAG = "proquote"
const DAY_MS = 24 * 60 * 60 * 1000

describe("a pro's quote (story 12.8d)", () => {
  let app: FastifyInstance
  const henrri = createFakeHenrri()
  let fixtures: ReturnType<typeof proFixtures>
  let pro: Account
  let otherPro: Account
  let admin: Account
  let rifle: FixtureProduct

  const call = (method: "GET" | "POST", url: string, token: string) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}` } })
  const asPro = (url: string, token = pro.token) => call("GET", `/api/pro/quote-requests${url}`, token)

  /** A request SCS has taken in hand: its quote is being prepared. */
  async function inReview() {
    await app.inject({
      method: "POST",
      url: "/api/pro/quote-basket/items",
      headers: { authorization: `Bearer ${pro.token}` },
      payload: { variantId: rifle.variantId, qty: 2 },
    })
    const request = (await call("POST", "/api/pro/quote-requests", pro.token)).json().data as { id: string }
    await call("POST", `/api/admin/quote-requests/${request.id}/review`, admin.token)
    return request
  }

  /** As the queue leaves it once Henrri has issued the quote. */
  async function issued(quoteRequestId: string, validUntil = parisToday(new Date(Date.now() + 10 * DAY_MS))) {
    const henrriDocumentId = await henrri.client.createDocument({
      documentTypeId: FAKE_TYPES.quotation,
      customerId: 1,
      title: "Devis",
    })
    await henrri.client.addLine(henrriDocumentId, {
      designation: "Carabine",
      article: { reference: "CAR", description: "Carabine" },
      quantity: 1,
      unitPrice: 1,
      vatPct: 20,
    })
    const { number } = await henrri.client.finalizeDocument(henrriDocumentId)
    await db
      .update(quoteRequests)
      .set({ status: "sent", sentAt: new Date(), totalTtc: "2652.80", validUntil: validityDate(validUntil) })
      .where(eq(quoteRequests.id, quoteRequestId))
    await db.insert(henrriDocuments).values({
      quoteRequestId,
      kind: "quotation",
      status: "finalized",
      henrriDocumentId,
      henrriNumber: number,
      expectedTotalTtc: "2652.80",
      finalizedAt: new Date(),
      customerNotifiedAt: new Date(),
    })
    return number as string
  }

  beforeAll(async () => {
    app = await buildApp({ henrri: henrri.client })
    await app.ready()
    fixtures = proFixtures(app, TAG)
    await fixtures.cleanup()
    pro = await fixtures.account({ organisation: "approved" })
    otherPro = await fixtures.account({ organisation: "approved" })
    admin = await fixtures.account({ role: "admin" })
    await db
      .update(organisations)
      .set({ discountPct: "10.00" })
      .where(eq(organisations.id, pro.organisationId as string))
    rifle = await fixtures.product("rifle", { categorySlug: "arme-longue", legalCategory: "C", priceHt: 1200 })
  })

  afterAll(async () => {
    await fixtures.cleanup()
    await app.close()
  })

  it("shows no figure while SCS prepares the quote", async () => {
    const request = await inReview()

    const body = (await asPro(`/${request.id}`)).json().data

    expect(body.quote).toBeNull()
    expect(JSON.stringify(body)).not.toMatch(/quotedPriceHt|publicPriceHt|1205/)
    expect((await asPro(`/${request.id}/quote.pdf`)).statusCode).toBe(404)
  })

  it("shows the issued quote: its number, validity, prices and totals", async () => {
    const request = await inReview()
    const number = await issued(request.id, "2026-12-31")

    const body = (await asPro(`/${request.id}`)).json().data

    expect(body.status).toBe("sent")
    expect(body.validUntil).toBe("2026-12-31")
    expect(body.quote).toMatchObject({ number, validUntil: "2026-12-31", shippingTtc: 50 })
    expect(body.quote.totals).toEqual({ totalHt: 2210.67, vatAmount: 442.13, totalTtc: 2652.8 })
    expect(body.quote.items).toEqual([{ id: body.items[0].id, qty: 2, unitPriceHt: 1084.5, lineHt: 2169 }])
    expect(JSON.stringify(body)).not.toMatch(/publicPriceHt|lineDiscountPct/)
  })

  // Story 12.8d-2 — what the pro needs to accept it.
  it("tells the pro whether the quote can be accepted, and why not", async () => {
    const request = await inReview()
    await issued(request.id)

    const waiting = (await asPro(`/${request.id}`)).json().data.quote
    expect(waiting).toMatchObject({ acceptable: false, refusal: "DocumentsRequired", net30: false, orderId: null })

    await db
      .update(quoteRequests)
      .set({ documentsSufficientAt: new Date(), documentsSufficientBy: admin.id })
      .where(eq(quoteRequests.id, request.id))
    expect((await asPro(`/${request.id}`)).json().data.quote).toMatchObject({ acceptable: true, refusal: null })
  })

  it("downloads the quote's PDF, as Henrri made it, and only for its organisation", async () => {
    const request = await inReview()
    const number = await issued(request.id)

    const res = await asPro(`/${request.id}/quote.pdf`)

    expect(res.statusCode).toBe(200)
    expect(res.headers["content-type"]).toBe("application/pdf")
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="Devis-${number}.pdf"`)
    expect(res.headers["cache-control"]).toBe("private, no-store")
    expect(res.body).toContain(`%PDF fake ${number}`)
    expect((await asPro(`/${request.id}/quote.pdf`, otherPro.token)).statusCode).toBe(404)
    expect((await asPro(`/${request.id}`, otherPro.token)).statusCode).toBe(404)
  })

  describe("expiry", () => {
    it("expires a sent quote once its last day is over, in Paris, and journals it", async () => {
      const past = await inReview()
      await issued(past.id, "2026-10-24")
      const lastDay = await inReview()
      await issued(lastDay.id, "2026-10-25")

      const result = await expireQuotes("2026-10-25")

      expect(result.quotes).toBeGreaterThanOrEqual(1)
      const status = async (id: string) =>
        (await db.select({ status: quoteRequests.status }).from(quoteRequests).where(eq(quoteRequests.id, id)))[0]
          ?.status
      expect(await status(past.id)).toBe("expired")
      expect(await status(lastDay.id)).toBe("sent")
      const events = await db.select().from(auditLogs).where(eq(auditLogs.entityId, past.id))
      expect(events.map((event) => event.action)).toContain("quote_request.expired")
    })

    it("leaves a request still in review alone, whatever its date", async () => {
      const request = await inReview()
      await db
        .update(quoteRequests)
        .set({ validUntil: validityDate("2020-01-01") })
        .where(eq(quoteRequests.id, request.id))

      await expireQuotes("2026-10-25")

      const [row] = await db.select().from(quoteRequests).where(eq(quoteRequests.id, request.id))
      expect(row.status).toBe("in_review")
    })
  })
})
