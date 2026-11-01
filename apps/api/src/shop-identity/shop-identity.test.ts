import { EMPTY_SHOP_IDENTITY, type ShopIdentity } from "@armurier/shared"
import { eq } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs } from "../db/schema.js"
import { createAccount, deleteAccounts } from "../test/account-fixtures.js"
import { loadShopIdentity, saveShopIdentity } from "./service.js"

const EMAIL_SUFFIX = "@shop-identity.local"
const ADMIN_URL = "/api/admin/shop-identity"

const filled: ShopIdentity = {
  ...EMPTY_SHOP_IDENTITY,
  companyName: "SCS Firearms",
  email: "contact@scs-firearms.fr",
  phone: "04 78 00 00 00",
  address: "3 quai du Stand, 69002 Lyon",
  contactHours: "Du mardi au samedi, 9 h – 18 h",
}

describe("the shop's identity record (audit 2026-11-01, I8)", () => {
  let app: FastifyInstance
  let original: ShopIdentity

  const put = (token: string | null, payload: object) =>
    app.inject({
      method: "PUT",
      url: ADMIN_URL,
      ...(token && { headers: { authorization: `Bearer ${token}` } }),
      payload,
    })

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    original = await loadShopIdentity()
  })

  afterAll(async () => {
    await saveShopIdentity(original)
    await deleteAccounts(EMAIL_SUFFIX)
    await app.close()
  })

  it("is read by anyone, briefly cached: the legal pages and /contact show it", async () => {
    await saveShopIdentity(filled)
    const res = await app.inject({ method: "GET", url: "/api/shop-identity" })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual(filled)
    expect(res.headers["cache-control"]).toBe("public, max-age=60")
  })

  it("is replaced whole by an admin, journaled with what it was", async () => {
    await saveShopIdentity(EMPTY_SHOP_IDENTITY)
    const admin = await createAccount(app, EMAIL_SUFFIX, { role: "admin" })

    const res = await put(admin.token, { ...filled, siret: "912 345 678 00012" })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ companyName: "SCS Firearms", siret: "91234567800012" })
    expect(await loadShopIdentity()).toMatchObject({ siret: "91234567800012", contactHours: filled.contactHours })
    const [event] = await db.select().from(auditLogs).where(eq(auditLogs.userId, admin.id))
    expect(event).toMatchObject({
      action: "shop_identity.updated",
      oldValue: EMPTY_SHOP_IDENTITY,
      newValue: expect.objectContaining({ companyName: "SCS Firearms" }),
    })
    const read = await app.inject({
      method: "GET",
      url: ADMIN_URL,
      headers: { authorization: `Bearer ${admin.token}` },
    })
    expect(read.json().data.companyName).toBe("SCS Firearms")
  })

  it("refuses a malformed field, and anyone but an admin", async () => {
    const admin = await createAccount(app, EMAIL_SUFFIX, { role: "admin" })
    const customer = await createAccount(app, EMAIL_SUFFIX)

    const bad = await put(admin.token, { ...filled, email: "pas-un-email" })
    expect(bad.statusCode).toBe(400)
    expect((await put(customer.token, filled)).statusCode).toBe(403)
    expect((await put(null, filled)).statusCode).toBe(401)
  })
})
