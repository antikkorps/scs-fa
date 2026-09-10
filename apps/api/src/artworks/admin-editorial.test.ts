import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { artists, artworkSeries, artworkThemes, auditLogs, users } from "../db/schema.js"

const PASSWORD = "MotDePasseTresLong123!"
const ADMIN_EMAIL = "testedito-admin@testedito.local"
const CUSTOMER_EMAIL = "testedito-cust@testedito.local"
const SLUG = "testeditoadmin-"
const BASE = "/api/admin/gun-art"

describe("admin Gun Art editorial CRUD (story 7.5a)", () => {
  let app: FastifyInstance
  let adminToken: string
  let customerToken: string

  async function cleanup() {
    const userIds = db.select({ id: users.id }).from(users).where(like(users.email, "testedito-%"))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
    await db.delete(users).where(like(users.email, "testedito-%"))
    await db.delete(artworkSeries).where(like(artworkSeries.slug, `${SLUG}%`))
    await db.delete(artworkThemes).where(like(artworkThemes.slug, `${SLUG}%`))
    await db.delete(artists).where(like(artists.slug, `${SLUG}%`))
  }

  async function makeUser(email: string, role: "customer" | "admin") {
    const passwordHash = await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
    await db.insert(users).values({
      email,
      passwordHash,
      role,
      firstname: "Test",
      lastname: role === "admin" ? "Admin" : "Client",
      rgpdConsentAt: new Date(),
      rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
    })
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } })
    return login.json().accessToken as string
  }

  const asAdmin = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${adminToken}` }, ...(payload ? { payload } : {}) })

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()
    adminToken = await makeUser(ADMIN_EMAIL, "admin")
    customerToken = await makeUser(CUSTOMER_EMAIL, "customer")
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it("refuses anyone but an admin, on every entity", async () => {
    for (const url of [`${BASE}/artists`, `${BASE}/themes`, `${BASE}/series`]) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401)
      const asCustomer = await app.inject({
        method: "GET",
        url,
        headers: { authorization: `Bearer ${customerToken}` },
      })
      expect(asCustomer.statusCode).toBe(403)
    }
  })

  describe("artists", () => {
    it("creates, reads back and updates an artist", async () => {
      const created = await asAdmin("POST", `${BASE}/artists`, {
        slug: `${SLUG}artiste`,
        name: "Artiste de test",
        bio: "Une bio.",
        bookTitle: "Un livre",
        bookUrl: "https://www.amazon.fr/dp/TEST",
        published: true,
      })
      expect(created.statusCode).toBe(201)
      const id = created.json().data.id

      const patched = await asAdmin("PATCH", `${BASE}/artists/${id}`, { headline: "Une accroche" })
      expect(patched.statusCode).toBe(200)
      expect(patched.json().data.headline).toBe("Une accroche")
      expect(patched.json().data.name).toBe("Artiste de test")

      const read = await asAdmin("GET", `${BASE}/artists/${id}`)
      expect(read.json().data.bookUrl).toBe("https://www.amazon.fr/dp/TEST")
    })

    it("refuses a duplicate slug rather than letting Postgres 500", async () => {
      const again = await asAdmin("POST", `${BASE}/artists`, { slug: `${SLUG}artiste`, name: "Doublon" })
      expect(again.statusCode).toBe(409)
    })

    it("rejects a malformed slug and an unknown field", async () => {
      expect((await asAdmin("POST", `${BASE}/artists`, { slug: "Pas Un Slug", name: "X" })).statusCode).toBe(400)
      expect((await asAdmin("POST", `${BASE}/artists`, { slug: `${SLUG}x`, name: "X", inconnu: 1 })).statusCode).toBe(
        400,
      )
    })

    it("404s on an unknown id", async () => {
      const ghost = "00000000-0000-4000-8000-000000000000"
      expect((await asAdmin("PATCH", `${BASE}/artists/${ghost}`, { name: "X" })).statusCode).toBe(404)
      expect((await asAdmin("DELETE", `${BASE}/artists/${ghost}`)).statusCode).toBe(404)
    })
  })

  describe("themes and series", () => {
    let themeId: string
    let artistId: string

    beforeAll(async () => {
      themeId = (
        await asAdmin("POST", `${BASE}/themes`, { slug: `${SLUG}theme`, name: "Thème de test", displayOrder: 3 })
      ).json().data.id
      artistId = (await asAdmin("POST", `${BASE}/artists`, { slug: `${SLUG}auteur`, name: "Auteur de test" })).json()
        .data.id
    })

    it("creates a series bound to a theme and an artist", async () => {
      const created = await asAdmin("POST", `${BASE}/series`, {
        slug: `${SLUG}serie`,
        title: "Série de test",
        intro: "Présentation.",
        reference: "Un film",
        themeId,
        artistId,
        published: true,
      })
      expect(created.statusCode).toBe(201)
      expect(created.json().data.themeId).toBe(themeId)
    })

    it("names the dangling reference instead of surfacing a database error", async () => {
      const ghost = "00000000-0000-4000-8000-000000000000"
      const res = await asAdmin("POST", `${BASE}/series`, { slug: `${SLUG}orphan`, title: "X", themeId: ghost })
      expect(res.statusCode).toBe(400)
      expect(res.json().message).toContain("Unknown theme")
    })

    /**
     * The counts are what the admin decides a deletion on: the FKs are
     * `on delete set null`, so removing a theme empties a label rather than
     * destroying a series — but only if you can see what points at it first.
     */
    it("reports what points at each entity", async () => {
      const themes = (await asAdmin("GET", `${BASE}/themes`)).json().data as Array<{
        slug: string
        seriesCount: number
      }>
      expect(themes.find((t) => t.slug === `${SLUG}theme`)?.seriesCount).toBe(1)

      const artistRows = (await asAdmin("GET", `${BASE}/artists`)).json().data as Array<{
        slug: string
        seriesCount: number
        artworkCount: number
      }>
      const mine = artistRows.find((a) => a.slug === `${SLUG}auteur`)
      expect(mine?.seriesCount).toBe(1)
      expect(mine?.artworkCount).toBe(0)
    })

    it("keeps the series alive when its theme is deleted, only clearing the label", async () => {
      expect((await asAdmin("DELETE", `${BASE}/themes/${themeId}`)).statusCode).toBe(204)

      const series = (await asAdmin("GET", `${BASE}/series`)).json().data as Array<{
        slug: string
        themeId: string | null
      }>
      const mine = series.find((s) => s.slug === `${SLUG}serie`)
      expect(mine).toBeDefined()
      expect(mine?.themeId).toBeNull()
    })
  })
})
