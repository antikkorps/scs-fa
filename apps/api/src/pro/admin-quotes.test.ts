import { eq, inArray } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, quoteRequests } from "../db/schema.js"
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

  const asAdmin = (method: "GET" | "POST", url: string, token = admin.token) =>
    app.inject({ method, url: `/api/admin/quote-requests${url}`, headers: { authorization: `Bearer ${token}` } })

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
