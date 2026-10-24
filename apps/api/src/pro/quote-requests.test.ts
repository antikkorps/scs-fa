import { eq } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, products, quoteBasketItems, quoteRequestItems, quoteRequests } from "../db/schema.js"
import { sendQuoteRequestAlertEmail, sendQuoteRequestReceivedEmail } from "../email.js"
import { type Account, type FixtureProduct, proFixtures } from "../test/pro-fixtures.js"
import { QUOTE_REQUESTS_PER_HOUR } from "./quote-requests.js"

vi.mock("../email.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../email.js")>()),
  sendQuoteRequestReceivedEmail: vi.fn().mockResolvedValue(undefined),
  sendQuoteRequestAlertEmail: vi.fn().mockResolvedValue(undefined),
}))

const TAG = "proquote"

describe("quote requests, the pro's side (story 12.8c)", () => {
  let app: FastifyInstance
  let fixtures: ReturnType<typeof proFixtures>
  let pro: Account
  const product: Record<string, FixtureProduct> = {}

  const call = (method: "GET" | "POST", url: string, payload?: object, token = pro.token) =>
    app.inject({
      method,
      url: `/api/pro${url}`,
      headers: { authorization: `Bearer ${token}` },
      ...(payload ? { payload } : {}),
    })
  const fill = async (lines: Array<[FixtureProduct | undefined, number]>, account = pro) => {
    for (const [item, qty] of lines) {
      const res = await call("POST", "/quote-basket/items", { variantId: item?.variantId, qty }, account.token)
      expect(res.statusCode).toBe(201)
    }
  }
  const submit = (payload: object = {}, token = pro.token) => call("POST", "/quote-requests", payload, token)

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    fixtures = proFixtures(app, TAG)
    await fixtures.cleanup()
    pro = await fixtures.account({ organisation: "approved" })
    product.vest = await fixtures.product("vest", { audience: "pro", priceHt: 400 })
    product.rifle = await fixtures.product("rifle", { categorySlug: "arme-longue", legalCategory: "C", priceHt: 1200 })
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    await db.delete(quoteBasketItems).where(eq(quoteBasketItems.userId, pro.id))
  })

  afterAll(async () => {
    await fixtures.cleanup()
    await app.close()
  })

  describe("POST /api/pro/quote-requests", () => {
    it("turns the basket into a numbered request and empties the basket", async () => {
      await fill([
        [product.vest, 3],
        [product.rifle, 1],
      ])

      const res = await submit({ message: "  Livraison au commissariat central.  " })

      expect(res.statusCode).toBe(201)
      const request = res.json().data
      expect(request.number).toMatch(new RegExp(`^DR-${new Date().getFullYear()}-\\d{4,}$`))
      expect(request).toMatchObject({ status: "requested", message: "Livraison au commissariat central." })
      expect(request.items.map((item: { productName: string; qty: number }) => [item.productName, item.qty])).toEqual([
        [product.vest?.name, 3],
        [product.rifle?.name, 1],
      ])
      expect(JSON.stringify(request)).not.toMatch(/publicPrice|priceHt|vatPct/)
      expect(await db.select().from(quoteBasketItems).where(eq(quoteBasketItems.userId, pro.id))).toEqual([])
    })

    it("freezes each line with what SCS needs to quote, the public price included", async () => {
      await fill([[product.rifle, 2]])
      const { id } = (await submit()).json().data

      const [line] = await db.select().from(quoteRequestItems).where(eq(quoteRequestItems.quoteRequestId, id))
      expect(line).toMatchObject({
        position: 1,
        productId: product.rifle?.id,
        variantId: product.rifle?.variantId,
        productName: product.rifle?.name,
        productSku: product.rifle?.sku,
        variantSku: `${product.rifle?.sku}-STD`,
        variantLabel: "noir",
        legalCategory: "C",
        qty: 2,
        // 1 200 € + the variant's 5 €.
        publicPriceHt: "1205.00",
        vatPct: "20.00",
        quotedPriceHt: null,
      })

      // A later edit of the product leaves the request as it was asked.
      await db
        .update(products)
        .set({ name: "Renamed" })
        .where(eq(products.id, product.rifle?.id as string))
      const shown = (await call("GET", `/quote-requests/${id}`)).json().data
      expect(shown.items[0].productName).toBe(product.rifle?.name)
      await db
        .update(products)
        .set({ name: product.rifle?.name })
        .where(eq(products.id, product.rifle?.id as string))
    })

    it("journals the request and mails the pro and SCS", async () => {
      await fill([[product.vest, 1]])
      const { id, number } = (await submit()).json().data

      const events = await db.select().from(auditLogs).where(eq(auditLogs.entityId, id))
      expect(events.map((event) => event.action)).toEqual(["quote_request.submitted"])
      expect(sendQuoteRequestReceivedEmail).toHaveBeenCalledWith(
        pro.email,
        { number, lineCount: 1 },
        { userId: pro.id },
      )
      expect(sendQuoteRequestAlertEmail).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ number, legalName: `Armurerie ${TAG}`, lineCount: 1 }),
      )
    })

    it("numbers each request apart", async () => {
      await fill([[product.vest, 1]])
      const first = (await submit()).json().data.number
      await fill([[product.vest, 1]])
      const second = (await submit()).json().data.number
      expect(second).not.toBe(first)
    })

    // Story 12.9g — each request mails every admin: a pro account cannot flood them.
    it("refuses a request past the organisation's hourly cap, mailing no one", async () => {
      const busy = await fixtures.account({ organisation: "approved" })
      const { organisationId } = busy
      if (!organisationId) throw new Error("fixture account without an organisation")
      await db.insert(quoteRequests).values(
        Array.from({ length: QUOTE_REQUESTS_PER_HOUR }, (_, index) => ({
          number: `CAP-${Date.now() % 1_000_000}-${index}`,
          organisationId,
          requestedBy: busy.id,
        })),
      )
      await fill([[product.vest, 1]], busy)

      const res = await submit({}, busy.token)

      expect(res.statusCode).toBe(429)
      expect(res.json().error).toBe("TooManyQuoteRequests")
      expect(sendQuoteRequestAlertEmail).not.toHaveBeenCalled()
      // The basket is kept for later.
      expect(await db.select().from(quoteBasketItems).where(eq(quoteBasketItems.userId, busy.id))).toHaveLength(1)
    })

    it("refuses an empty basket", async () => {
      const res = await submit()
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe("EmptyBasket")
    })

    it("refuses a basket holding a product gone offline, naming it, and keeps the basket", async () => {
      const offline = await fixtures.product("offline")
      await fill([
        [product.vest, 1],
        [offline, 1],
      ])
      await db.update(products).set({ published: false }).where(eq(products.id, offline.id))

      const res = await submit()

      expect(res.statusCode).toBe(409)
      expect(res.json()).toMatchObject({ error: "UnavailableItems", items: [offline.name] })
      expect(await db.select().from(quoteBasketItems).where(eq(quoteBasketItems.userId, pro.id))).toHaveLength(2)
    })
  })

  describe("following and cancelling", () => {
    it("lists the organisation's requests, newest first, and nobody else's", async () => {
      await fill([[product.vest, 1]])
      const older = (await submit()).json().data
      await fill([[product.rifle, 1]])
      const newer = (await submit()).json().data
      const stranger = await fixtures.account({ organisation: "approved" })

      const mine = (await call("GET", "/quote-requests")).json().data
      expect(mine.slice(0, 2).map((row: { id: string }) => row.id)).toEqual([newer.id, older.id])
      expect(mine[0]).toMatchObject({ number: newer.number, status: "requested", lineCount: 1 })

      expect((await call("GET", "/quote-requests", undefined, stranger.token)).json().data).toEqual([])
      expect((await call("GET", `/quote-requests/${newer.id}`, undefined, stranger.token)).statusCode).toBe(404)
    })

    it("cancels a request SCS has not started on, and only that", async () => {
      await fill([[product.vest, 1]])
      const { id } = (await submit()).json().data

      const res = await call("POST", `/quote-requests/${id}/cancel`)
      expect(res.statusCode).toBe(200)
      expect(res.json().data.status).toBe("cancelled")
      expect((await call("POST", `/quote-requests/${id}/cancel`)).statusCode).toBe(409)

      await fill([[product.vest, 1]])
      const started = (await submit()).json().data
      await db.update(quoteRequests).set({ status: "in_review" }).where(eq(quoteRequests.id, started.id))
      const late = await call("POST", `/quote-requests/${started.id}/cancel`)
      expect(late.statusCode).toBe(409)
      expect(late.json().error).toBe("NotCancellable")
    })
  })
})
