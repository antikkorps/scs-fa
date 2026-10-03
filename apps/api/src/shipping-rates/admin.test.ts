import { CURRENT_RGPD_CONSENT_VERSION, type ShippingRates } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { and, eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, shippingRates, users } from "../db/schema.js"
import { loadShippingRates } from "./service.js"

const PASSWORD = "MotDePasseTresLong123!"
const BASE = "/api/admin/shipping-rates"
const GRID: ShippingRates = { firearmParcelTtc: 32.5, smallParcelTtc: 7.9, smallParcelFreeFromTtc: 99, printTtc: 18 }

describe("admin shipping rate grid (story 12.3)", () => {
  let app: FastifyInstance
  let adminToken: string
  let customerToken: string
  let original: ShippingRates

  async function cleanup() {
    const userIds = db.select({ id: users.id }).from(users).where(like(users.email, "testshiprates-%"))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
    await db.delete(users).where(like(users.email, "testshiprates-%"))
  }

  async function makeUser(email: string, role: "customer" | "admin") {
    const passwordHash = await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
    await db.insert(users).values({
      email,
      passwordHash,
      role,
      firstname: "Test",
      lastname: "Tarifs",
      rgpdConsentAt: new Date(),
      rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
    })
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } })
    return login.json().accessToken as string
  }

  const put = (token: string, payload: unknown) =>
    app.inject({ method: "PUT", url: BASE, headers: { authorization: `Bearer ${token}` }, payload: payload as object })

  beforeAll(async () => {
    app = await buildApp()
    await cleanup()
    original = await loadShippingRates()
    adminToken = await makeUser("testshiprates-admin@testshiprates.local", "admin")
    customerToken = await makeUser("testshiprates-cust@testshiprates.local", "customer")
  })

  afterAll(async () => {
    // The grid is global: put back what the other suites price against.
    await put(adminToken, original)
    await cleanup()
    await app.close()
  })

  it("serves the seeded grid", async () => {
    const res = await app.inject({ method: "GET", url: BASE, headers: { authorization: `Bearer ${adminToken}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual(original)
  })

  it("is admin-only, read and write", async () => {
    const read = await app.inject({ method: "GET", url: BASE, headers: { authorization: `Bearer ${customerToken}` } })
    expect(read.statusCode).toBe(403)
    expect((await put(customerToken, GRID)).statusCode).toBe(403)
    expect((await app.inject({ method: "GET", url: BASE })).statusCode).toBe(401)
  })

  it("replaces the grid and journals who changed it from what", async () => {
    const res = await put(adminToken, GRID)
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual(GRID)
    expect(await loadShippingRates()).toEqual(GRID)

    const [log] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "shipping_rates.updated"), eq(auditLogs.userRole, "admin")))
      .orderBy(auditLogs.createdAt)
      .limit(1)
    expect(log?.oldValue).toEqual(original)
    expect(log?.newValue).toEqual(GRID)
  })

  it("accepts a grid with no free threshold", async () => {
    const res = await put(adminToken, { ...GRID, smallParcelFreeFromTtc: null })
    expect(res.statusCode).toBe(200)
    expect((await loadShippingRates()).smallParcelFreeFromTtc).toBeNull()
  })

  it("refuses a partial or negative grid and leaves the tariff alone", async () => {
    const before = await loadShippingRates()
    expect((await put(adminToken, { firearmParcelTtc: 10 })).statusCode).toBe(400)
    expect((await put(adminToken, { ...GRID, smallParcelTtc: -1 })).statusCode).toBe(400)
    expect(await loadShippingRates()).toEqual(before)
  })

  it("falls back to the default grid, never to free delivery, if the row is gone", async () => {
    const saved = await loadShippingRates()
    await db.delete(shippingRates)
    try {
      const rates = await loadShippingRates()
      expect(rates.firearmParcelTtc).toBeGreaterThan(0)
      expect(rates.smallParcelTtc).toBeGreaterThan(0)
    } finally {
      await put(adminToken, saved)
    }
  })
})
