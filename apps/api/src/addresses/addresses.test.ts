import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { addresses, auditLogs, users } from "../db/schema.js"

const PASSWORD = "MotDePasseTresLong123!"
const EMAIL = "addr-test@addr-test.local"
const EMAIL_OTHER = "addr-test-other@addr-test.local"

const VALID = {
  label: "Domicile",
  firstName: "Jean",
  lastName: "Dupont",
  line1: "10 rue des Armuriers",
  postal: "75001",
  city: "Paris",
}

describe("addresses (/api/addresses)", () => {
  let app: FastifyInstance
  let userId: string
  let otherUserId: string
  let token: string

  async function cleanup() {
    const userIds = db.select({ id: users.id }).from(users).where(like(users.email, "addr-test%"))
    await db.delete(addresses).where(inArray(addresses.userId, userIds))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
    await db.delete(users).where(like(users.email, "addr-test%"))
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()

    const passwordHash = await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
    const [u1] = await db
      .insert(users)
      .values({
        email: EMAIL,
        passwordHash,
        role: "customer",
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id })
    userId = u1.id
    const [u2] = await db
      .insert(users)
      .values({
        email: EMAIL_OTHER,
        passwordHash,
        role: "customer",
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id })
    otherUserId = u2.id

    token = (
      await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: EMAIL, password: PASSWORD } })
    ).json().accessToken
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  beforeEach(async () => {
    await db.delete(addresses).where(inArray(addresses.userId, [userId, otherUserId]))
  })

  function headers() {
    return { authorization: `Bearer ${token}` }
  }
  function create(payload: Record<string, unknown>) {
    return app.inject({ method: "POST", url: "/api/addresses", headers: headers(), payload })
  }

  it("requires authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/api/addresses" })
    expect(res.statusCode).toBe(401)
  })

  it("creates an address and makes the first one default", async () => {
    const res = await create(VALID)
    expect(res.statusCode).toBe(201)
    const { data } = res.json()
    expect(data).toMatchObject({ line1: "10 rue des Armuriers", city: "Paris", country: "FR", type: "both" })
    expect(data.isDefault).toBe(true)
  })

  it("rejects an invalid payload", async () => {
    const res = await create({ firstName: "Jean" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe("ValidationError")
  })

  it("lists the user's addresses with the default first", async () => {
    await create(VALID)
    await create({ ...VALID, label: "Bureau", line1: "5 av. du Travail", isDefault: true })
    const res = await app.inject({ method: "GET", url: "/api/addresses", headers: headers() })
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data).toHaveLength(2)
    expect(data[0].label).toBe("Bureau")
    expect(data[0].isDefault).toBe(true)
    // setting a new default unsets the previous one
    expect(data.filter((a: { isDefault: boolean }) => a.isDefault)).toHaveLength(1)
  })

  it("updates an address", async () => {
    const created = (await create(VALID)).json().data
    const res = await app.inject({
      method: "PATCH",
      url: `/api/addresses/${created.id}`,
      headers: headers(),
      payload: { city: "Lyon", postal: "69001" },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ city: "Lyon", postal: "69001" })
  })

  it("returns 404 when updating an unknown address", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/addresses/00000000-0000-0000-0000-000000000000",
      headers: headers(),
      payload: { city: "Lyon" },
    })
    expect(res.statusCode).toBe(404)
  })

  it("deletes an address", async () => {
    const created = (await create(VALID)).json().data
    const del = await app.inject({ method: "DELETE", url: `/api/addresses/${created.id}`, headers: headers() })
    expect(del.statusCode).toBe(204)
    const list = await app.inject({ method: "GET", url: "/api/addresses", headers: headers() })
    expect(list.json().data).toEqual([])
  })
})
