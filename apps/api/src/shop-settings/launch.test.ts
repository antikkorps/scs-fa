import type { LaunchStage } from "@armurier/shared"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { shopSettings } from "../db/schema.js"
import { type Account, proFixtures } from "../test/pro-fixtures.js"
import { loadShopSettings } from "./service.js"

const SOME_ID = "00000000-0000-4000-8000-000000000000"

interface SalesRoute {
  method: "POST" | "PATCH"
  url: string
  /** Who calls it: nobody (sign-ups), a customer, or a member of an approved organisation. */
  as: "anonymous" | "customer" | "pro"
}

// Every way in to a sale (story 12.10): accounts, cart, order, payment, quotes.
const SALES_ROUTES: SalesRoute[] = [
  { method: "POST", url: "/api/auth/register", as: "anonymous" },
  { method: "POST", url: "/api/organisations/signup", as: "anonymous" },
  { method: "POST", url: "/api/organisations/request", as: "customer" },
  { method: "POST", url: "/api/cart/items", as: "customer" },
  { method: "PATCH", url: `/api/cart/items/${SOME_ID}`, as: "customer" },
  { method: "POST", url: "/api/orders", as: "customer" },
  { method: "POST", url: "/api/payments/stripe/intent", as: "customer" },
  { method: "POST", url: "/api/pro/quote-basket/items", as: "pro" },
  { method: "PATCH", url: `/api/pro/quote-basket/items/${SOME_ID}`, as: "pro" },
  { method: "POST", url: "/api/pro/quote-requests", as: "pro" },
  { method: "POST", url: `/api/pro/quote-requests/${SOME_ID}/accept`, as: "pro" },
]

describe("launch stage (story 12.10)", () => {
  let app: FastifyInstance
  let fixtures: ReturnType<typeof proFixtures>
  let customer: Account
  let pro: Account
  let originalStage: LaunchStage

  const setStage = (launchStage: LaunchStage) => db.update(shopSettings).set({ launchStage })

  function call(route: SalesRoute) {
    const caller = { anonymous: null, customer, pro }[route.as]
    const headers = caller ? { authorization: `Bearer ${caller.token}` } : {}
    return app.inject({ method: route.method, url: route.url, headers, payload: {} })
  }

  beforeAll(async () => {
    app = await buildApp()
    fixtures = proFixtures(app, "testlaunchstage")
    await fixtures.cleanup()
    originalStage = (await loadShopSettings()).launchStage
    customer = await fixtures.account()
    pro = await fixtures.account({ organisation: "approved" })
  })

  afterAll(async () => {
    // The stage is global: every other suite sells against an open shop.
    await setStage(originalStage)
    await fixtures.cleanup()
    await app.close()
  })

  describe("GET /api/shop-status", () => {
    it("tells anyone the stage and whether to index, and nothing else", async () => {
      await db.update(shopSettings).set({ launchStage: "showcase", indexingEnabled: false })
      const res = await app.inject({ method: "GET", url: "/api/shop-status" })
      expect(res.statusCode).toBe(200)
      expect(res.json().data).toEqual({ launchStage: "showcase", indexingEnabled: false })
    })
  })

  describe.each<LaunchStage>(["coming_soon", "showcase"])("while %s", (stage) => {
    beforeAll(() => setStage(stage))

    it.each(SALES_ROUTES)("refuses $method $url with ShopNotOpen", async (route) => {
      const res = await call(route)
      expect(res.statusCode).toBe(403)
      expect(res.json().error).toBe("ShopNotOpen")
    })

    it("still asks who is calling before telling the shop is closed", async () => {
      const res = await app.inject({ method: "POST", url: "/api/cart/items", payload: {} })
      expect(res.statusCode).toBe(401)
    })
  })

  describe("once open", () => {
    beforeAll(() => setStage("open"))

    it.each(SALES_ROUTES)("lets $method $url through to its own checks", async (route) => {
      const res = await call(route)
      expect(res.json().error).not.toBe("ShopNotOpen")
    })
  })
})
