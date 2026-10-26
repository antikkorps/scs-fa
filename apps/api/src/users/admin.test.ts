import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { eq, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { organisations, users } from "../db/schema.js"

const EMAIL_SUFFIX = "@adminusers.local"

describe("GET /api/admin/users — find an account from the back-office", () => {
  let app: FastifyInstance
  let adminToken: string
  const tag = `s${Date.now()}`

  async function account(values: Partial<typeof users.$inferInsert> & { local: string }) {
    const { local, ...rest } = values
    const [row] = await db
      .insert(users)
      .values({
        email: `${local}-${tag}${EMAIL_SUFFIX}`,
        passwordHash: "x",
        firstname: "Jeanne",
        lastname: "Armand",
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
        ...rest,
      })
      .returning()
    return row
  }

  const search = (q: string, token = adminToken) =>
    app.inject({
      method: "GET",
      url: `/api/admin/users?q=${encodeURIComponent(q)}`,
      headers: { authorization: `Bearer ${token}` },
    })

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    const admin = await account({ local: "admin", role: "admin" })
    adminToken = app.jwt.sign({ sub: admin.id, role: "admin" })
  })

  afterAll(async () => {
    await db.delete(users).where(like(users.email, `%${EMAIL_SUFFIX}`))
    await app.close()
  })

  it("finds accounts by e-mail, first name, last name or full name, with their second factor", async () => {
    const withApp = await account({ local: "marcel", firstname: "Marcel", lastname: tag, totpEnabledAt: new Date() })
    const without = await account({ local: "odile", firstname: "Odile", lastname: tag })

    const byLastName = (await search(tag)).json().data
    expect(byLastName.map((user: { id: string }) => user.id)).toEqual(expect.arrayContaining([withApp.id, without.id]))
    expect(byLastName.find((user: { id: string }) => user.id === withApp.id)).toEqual({
      id: withApp.id,
      email: withApp.email,
      firstname: "Marcel",
      lastname: tag,
      role: "customer",
      isPro: false,
      totpEnabled: true,
      createdAt: expect.any(String),
    })
    expect((await search(`odile-${tag}`)).json().data.map((user: { id: string }) => user.id)).toEqual([without.id])
    expect((await search(`Marcel ${tag}`)).json().data.map((user: { id: string }) => user.id)).toEqual([withApp.id])
    expect((await search(`marcel ${tag.toUpperCase()}`)).json().data).toHaveLength(1)
  })

  it("never returns a secret, and flags a pro account", async () => {
    const [organisation] = await db
      .insert(organisations)
      .values({
        legalName: `Armurerie ${tag}`,
        siret: `7${String(Date.now()).slice(-9)}${String(Math.floor(Math.random() * 1e4)).padStart(4, "0")}`,
        type: "armurier",
        status: "approved",
        registryCheck: "verified",
      })
      .returning()
    const pro = await account({ local: "pro", lastname: `pro${tag}`, organisationId: organisation.id })

    const res = await search(`pro${tag}`)

    expect(res.json().data).toEqual([expect.objectContaining({ id: pro.id, isPro: true })])
    expect(res.body).not.toMatch(/password|totpSecret|hash/i)
    await db.delete(users).where(like(users.email, `pro-${tag}%`))
    await db.delete(organisations).where(eq(organisations.id, organisation.id))
  })

  it("leaves deleted accounts out and treats % and _ as plain characters", async () => {
    await account({ local: "gone", lastname: `gone${tag}`, deletedAt: new Date() })
    await account({ local: "plain", lastname: `plain${tag}` })

    expect((await search(`gone${tag}`)).json().data).toEqual([])
    expect((await search(`%${tag}`)).json().data).toEqual([])
    expect((await search(`p_ain${tag}`)).json().data).toEqual([])
  })

  it("answers twenty accounts at most", async () => {
    for (let index = 0; index < 22; index++) await account({ local: `many${index}`, lastname: `many${tag}` })

    expect((await search(`many${tag}`)).json().data).toHaveLength(20)
  })

  it("refuses a search shorter than three characters", async () => {
    expect((await search("ab")).statusCode).toBe(400)
  })
})
