import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import {
  artworkCartItems,
  artworkPrints,
  artworks,
  auditLogs,
  orders,
  productCategories,
  products,
  users,
} from "../db/schema.js"
import { releasePrintFromCart, reservePrintForCart, reservePrintForOrder } from "./reservation.js"

const PREFIX = "TESTRES-"
const PASSWORD = "MotDePasseTresLong123!"
const EMAIL_A = "reservation-test-a@reservation-test.local"
const EMAIL_B = "reservation-test-b@reservation-test.local"

async function categoryId(slug: string): Promise<string> {
  const [row] = await db
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(eq(productCategories.slug, slug))
    .limit(1)
  if (!row) throw new Error(`Missing seeded product category: ${slug} (run db:seed)`)
  return row.id
}

describe("artwork print reservation", () => {
  let app: FastifyInstance
  let userAId: string
  let tokenA: string
  let tokenB: string
  let printId: string

  async function cleanup() {
    const testArtworkIds = db
      .select({ id: artworks.id })
      .from(artworks)
      .where(like(artworks.sku, `${PREFIX}%`))
    const testPrintIds = db
      .select({ id: artworkPrints.id })
      .from(artworkPrints)
      .where(inArray(artworkPrints.artworkId, testArtworkIds))
    const testUserIds = db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.email, [EMAIL_A, EMAIL_B]))

    await db.delete(artworkCartItems).where(inArray(artworkCartItems.printId, testPrintIds))
    // Drop the order ref before deleting orders (artwork_prints.order_id FK)
    await db.update(artworkPrints).set({ orderId: null }).where(inArray(artworkPrints.artworkId, testArtworkIds))
    await db.delete(orders).where(inArray(orders.userId, testUserIds))
    await db.delete(artworkPrints).where(inArray(artworkPrints.artworkId, testArtworkIds))
    await db.delete(artworks).where(like(artworks.sku, `${PREFIX}%`))
    await db.delete(products).where(like(products.sku, `${PREFIX}%`))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, testUserIds))
    await db.delete(users).where(inArray(users.email, [EMAIL_A, EMAIL_B]))
  }

  async function makeUser(email: string) {
    const passwordHash = await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
    const [u] = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        role: "customer",
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id })
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } })
    return { id: u.id, token: login.json().accessToken as string }
  }

  function addPrint(token: string) {
    return app.inject({
      method: "POST",
      url: "/api/cart/items",
      headers: { authorization: `Bearer ${token}` },
      payload: { printId, qty: 1 },
    })
  }

  function printStatus() {
    return db
      .select({ status: artworkPrints.status, orderId: artworkPrints.orderId })
      .from(artworkPrints)
      .where(eq(artworkPrints.id, printId))
      .limit(1)
      .then((r) => r[0])
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()

    const a = await makeUser(EMAIL_A)
    const b = await makeUser(EMAIL_B)
    userAId = a.id
    tokenA = a.token
    tokenB = b.token

    const gunArt = await categoryId("gun-art")
    const [artProduct] = await db
      .insert(products)
      .values({
        sku: `${PREFIX}art`,
        slug: `${PREFIX}art`,
        name: "Oeuvre Réservation",
        categoryId: gunArt,
        priceHt: "100.00",
        requiresLegalVerification: false,
        published: true,
      })
      .returning({ id: products.id })
    const [artwork] = await db
      .insert(artworks)
      .values({
        productId: artProduct.id,
        slug: `${PREFIX}artwork`,
        sku: `${PREFIX}artwork`,
        title: "Tirage Réservation",
        editionLimit: 25,
        basePriceHt: "50.00",
        priceIncrementHt: "2.00",
      })
      .returning({ id: artworks.id })
    const [print] = await db
      .insert(artworkPrints)
      .values({
        artworkId: artwork.id,
        printNumber: 1,
        totalPrints: 25,
        printDesignation: "1/25",
        formatId: "A4",
        priceHtUnit: "100.00",
        status: "available",
      })
      .returning({ id: artworkPrints.id })
    printId = print.id
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  beforeEach(async () => {
    await db.delete(artworkCartItems).where(inArray(artworkCartItems.printId, [printId]))
    await db.update(artworkPrints).set({ orderId: null, status: "available" }).where(eq(artworkPrints.id, printId))
    await db.delete(orders).where(inArray(orders.userId, [userAId]))
  })

  describe("helpers", () => {
    it("reservePrintForCart claims an available print once (compare-and-set)", async () => {
      const first = await reservePrintForCart(printId)
      expect(first).not.toBeNull()
      expect((await printStatus()).status).toBe("in_cart")

      const second = await reservePrintForCart(printId)
      expect(second).toBeNull()
    })

    it("releasePrintFromCart returns an in_cart print to available, and is a no-op otherwise", async () => {
      await reservePrintForCart(printId)
      const released = await releasePrintFromCart(printId)
      expect(released).not.toBeNull()
      expect((await printStatus()).status).toBe("available")

      // already available -> nothing to release
      expect(await releasePrintFromCart(printId)).toBeNull()
    })

    it("reservePrintForOrder promotes in_cart -> reserved and stamps the order", async () => {
      await reservePrintForCart(printId)
      const [order] = await db
        .insert(orders)
        .values({ userId: userAId, subtotalHt: "0", vatAmount: "0", totalTtc: "0" })
        .returning({ id: orders.id })

      const reserved = await reservePrintForOrder(printId, order.id)
      expect(reserved).not.toBeNull()
      const after = await printStatus()
      expect(after.status).toBe("reserved")
      expect(after.orderId).toBe(order.id)

      // no longer in_cart -> second promotion finds nothing
      expect(await reservePrintForOrder(printId, order.id)).toBeNull()
    })
  })

  describe("cart routes", () => {
    it("lets exactly one of two concurrent shoppers claim the same print", async () => {
      const [resA, resB] = await Promise.all([addPrint(tokenA), addPrint(tokenB)])
      const statuses = [resA.statusCode, resB.statusCode].sort()
      expect(statuses).toEqual([201, 409])
      expect((await printStatus()).status).toBe("in_cart")
    })

    it("blocks a second shopper until the holder releases the print", async () => {
      expect((await addPrint(tokenA)).statusCode).toBe(201)
      expect((await addPrint(tokenB)).statusCode).toBe(409)

      await app.inject({ method: "DELETE", url: "/api/cart", headers: { authorization: `Bearer ${tokenA}` } })
      expect((await printStatus()).status).toBe("available")

      expect((await addPrint(tokenB)).statusCode).toBe(201)
    })
  })
})
