import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { and, eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, users } from "../db/schema.js"
import { signIn } from "../test/sign-in.js"
import { loadShopSettings, type ShopSettings } from "./service.js"

const PASSWORD = "MotDePasseTresLong123!"
const BASE = "/api/admin/shop-settings"

describe("admin shop settings (stories 12.9e, 12.10)", () => {
  let app: FastifyInstance
  let adminToken: string
  let customerToken: string
  let original: ShopSettings

  async function cleanup() {
    const userIds = db.select({ id: users.id }).from(users).where(like(users.email, "testshopsettings-%"))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
    await db.delete(users).where(like(users.email, "testshopsettings-%"))
  }

  async function makeUser(email: string, role: "customer" | "admin") {
    const passwordHash = await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
    await db.insert(users).values({
      email,
      passwordHash,
      role,
      firstname: "Test",
      lastname: "Réglages",
      rgpdConsentAt: new Date(),
      rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
    })
    const login = await signIn(app, { email, password: PASSWORD })
    return login.json().accessToken as string
  }

  const put = (token: string, payload: unknown) =>
    app.inject({ method: "PUT", url: BASE, headers: { authorization: `Bearer ${token}` }, payload: payload as object })

  beforeAll(async () => {
    app = await buildApp()
    await cleanup()
    original = await loadShopSettings()
    adminToken = await makeUser("testshopsettings-admin@testshopsettings.local", "admin")
    customerToken = await makeUser("testshopsettings-cust@testshopsettings.local", "customer")
  })

  afterAll(async () => {
    // The settings are global: put back what the other suites price against.
    await put(adminToken, original)
    await cleanup()
    await app.close()
  })

  it("serves the seeded settings: half the margin back to a VIP, a demo shop open but unindexed", async () => {
    const res = await app.inject({ method: "GET", url: BASE, headers: { authorization: `Bearer ${adminToken}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ vipMarginSharePct: 50, launchStage: "open", indexingEnabled: false })
  })

  it("is admin-only, read and write", async () => {
    const read = await app.inject({ method: "GET", url: BASE, headers: { authorization: `Bearer ${customerToken}` } })
    expect(read.statusCode).toBe(403)
    expect((await put(customerToken, { ...original, vipMarginSharePct: 40 })).statusCode).toBe(403)
    expect((await app.inject({ method: "GET", url: BASE })).statusCode).toBe(401)
  })

  it("changes the settings and journals who changed them from what", async () => {
    const changed = { vipMarginSharePct: 40, launchStage: "showcase", indexingEnabled: true }
    const res = await put(adminToken, changed)
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual(changed)
    expect(await loadShopSettings()).toEqual(changed)

    const [log] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "shop_settings.updated"), eq(auditLogs.userRole, "admin")))
      .orderBy(auditLogs.createdAt)
      .limit(1)
    expect(log?.oldValue).toEqual(original)
    expect(log?.newValue).toEqual(changed)
  })

  it("refuses a share outside 0–100 %, an unknown stage, a partial body or an unknown field", async () => {
    const before = await loadShopSettings()
    expect((await put(adminToken, { ...before, vipMarginSharePct: 120 })).statusCode).toBe(400)
    expect((await put(adminToken, { ...before, vipMarginSharePct: -5 })).statusCode).toBe(400)
    expect((await put(adminToken, { ...before, launchStage: "closed" })).statusCode).toBe(400)
    expect((await put(adminToken, { vipMarginSharePct: 40 })).statusCode).toBe(400)
    expect((await put(adminToken, { ...before, extra: true })).statusCode).toBe(400)
    expect(await loadShopSettings()).toEqual(before)
  })
})
