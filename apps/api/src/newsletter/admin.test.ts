import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { newsletterContacts, newsletterSubscriptions, users } from "../db/schema.js"

const EMAIL_SUFFIX = "@adminnewsletter.local"

type Subscription = Omit<typeof newsletterSubscriptions.$inferInsert, "contactId">

describe("/api/admin/newsletter — subscribers in the back-office", () => {
  let app: FastifyInstance
  let adminToken: string
  let customerToken: string
  const tag = `n${Date.now()}`
  const contactIds: string[] = []

  /** A contact with its subscriptions; `email: null` is an anonymised trace. */
  async function contact(local: string | null, subscriptions: Subscription[], createdAt = new Date()) {
    const email = local === null ? null : `${tag}-${local}${EMAIL_SUFFIX}`
    const [row] = await db
      .insert(newsletterContacts)
      .values({ email, emailHash: `${tag}-${local ?? crypto.randomUUID()}`.padEnd(64, "0").slice(0, 64), createdAt })
      .returning()
    contactIds.push(row.id)
    if (subscriptions.length) {
      await db.insert(newsletterSubscriptions).values(subscriptions.map((sub) => ({ ...sub, contactId: row.id })))
    }
    return row
  }

  const get = (url: string, token = adminToken) =>
    app.inject({ method: "GET", url: `/api/admin/newsletter${url}`, headers: { authorization: `Bearer ${token}` } })

  async function account(local: string, role: "admin" | "customer") {
    const [row] = await db
      .insert(users)
      .values({
        email: `${local}-${tag}${EMAIL_SUFFIX}`,
        passwordHash: "x",
        role,
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning()
    return app.jwt.sign({ sub: row.id, role })
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    adminToken = await account("admin", "admin")
    customerToken = await account("customer", "customer")
  })

  afterAll(async () => {
    if (contactIds.length) await db.delete(newsletterContacts).where(inArray(newsletterContacts.id, contactIds))
    await db.delete(users).where(like(users.email, `%${EMAIL_SUFFIX}`))
    await app.close()
  })

  it("is reserved to admins", async () => {
    expect((await get("/", customerToken)).statusCode).toBe(403)
    expect((await get("/summary", customerToken)).statusCode).toBe(403)
    expect((await app.inject({ method: "GET", url: "/api/admin/newsletter" })).statusCode).toBe(401)
  })

  it("counts subscriptions per segment and status, and those not yet mirrored to the provider", async () => {
    const before = (await get("/summary")).json().data
    const now = new Date()
    await contact("count-a", [
      { segment: "armurerie", status: "confirmed", confirmedAt: now, providerSyncedAt: now },
      { segment: "gun_art", status: "confirmed", confirmedAt: now },
    ])
    await contact("count-b", [{ segment: "armurerie", status: "pending" }])
    await contact(null, [{ segment: "collection", status: "unsubscribed", unsubscribedAt: now }])

    const after = (await get("/summary")).json().data
    expect(after.segments.armurerie.confirmed - before.segments.armurerie.confirmed).toBe(1)
    expect(after.segments.armurerie.pending - before.segments.armurerie.pending).toBe(1)
    expect(after.segments.gun_art.confirmed - before.segments.gun_art.confirmed).toBe(1)
    expect(after.segments.collection.unsubscribed - before.segments.collection.unsubscribed).toBe(1)
    expect(after.contacts - before.contacts).toBe(2)
    expect(after.awaitingSync - before.awaitingSync).toBe(1)
  })

  it("lists the contacts that still have an address, newest first, with their consent proof", async () => {
    const confirmedAt = new Date("2026-10-20T09:00:00Z")
    const older = await contact(
      "list-old",
      [
        {
          segment: "collection",
          status: "confirmed",
          requestedAt: new Date("2026-10-20T08:00:00Z"),
          confirmedAt,
          consentSource: "/armes-de-collection",
          consentIp: "203.0.113.7",
          consentUserAgent: "Mozilla/5.0",
          providerSyncedAt: confirmedAt,
        },
        { segment: "armurerie", status: "unsubscribed", unsubscribedAt: confirmedAt },
      ],
      new Date("2026-10-20T08:00:00Z"),
    )
    const newer = await contact(
      "list-new",
      [{ segment: "gun_art", status: "pending" }],
      new Date("2026-10-21T08:00:00Z"),
    )
    await contact(null, [{ segment: "gun_art", status: "unsubscribed" }])

    const res = await get(`/?search=${tag}`)
    expect(res.statusCode).toBe(200)
    const { data, pagination } = res.json()
    const ids = data.map((row: { id: string }) => row.id)
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id))
    expect(pagination).toMatchObject({ page: 1, limit: 20, total: data.length })

    expect(data.find((row: { id: string }) => row.id === older.id)).toEqual({
      id: older.id,
      email: older.email,
      createdAt: "2026-10-20T08:00:00.000Z",
      subscriptions: [
        {
          segment: "armurerie",
          status: "unsubscribed",
          requestedAt: expect.any(String),
          confirmedAt: null,
          unsubscribedAt: confirmedAt.toISOString(),
          consentSource: null,
          consentIp: null,
          synced: false,
        },
        {
          segment: "collection",
          status: "confirmed",
          requestedAt: "2026-10-20T08:00:00.000Z",
          confirmedAt: confirmedAt.toISOString(),
          unsubscribedAt: null,
          consentSource: "/armes-de-collection",
          consentIp: "203.0.113.7",
          synced: true,
        },
      ],
    })
  })

  it("filters by segment and status on the same subscription, and by address", async () => {
    const both = await contact("filter-both", [
      { segment: "armurerie", status: "confirmed" },
      { segment: "gun_art", status: "pending" },
    ])
    const other = await contact("filter-other", [{ segment: "armurerie", status: "pending" }])

    const ids = async (query: string) =>
      (await get(`/?search=${tag}-filter-&${query}`)).json().data.map((row: { id: string }) => row.id)

    expect(await ids("segment=armurerie&status=confirmed")).toEqual([both.id])
    expect(await ids("segment=gun_art&status=confirmed")).toEqual([])
    expect((await ids("status=pending")).sort()).toEqual([both.id, other.id].sort())
    expect(await ids("segment=gun_art")).toEqual([both.id])
    expect((await get(`/?search=${tag}-filter-other`)).json().data.map((row: { id: string }) => row.id)).toEqual([
      other.id,
    ])
  })

  it("treats % and _ in the search as plain characters", async () => {
    expect((await get("/?search=%25")).json().data).toEqual([])
    expect((await get("/?search=_")).json().data).toEqual([])
  })

  it("paginates", async () => {
    await contact("page-1", [{ segment: "armurerie", status: "pending" }])
    await contact("page-2", [{ segment: "armurerie", status: "pending" }])
    const first = (await get(`/?search=${tag}-page-&limit=1`)).json()
    expect(first.data).toHaveLength(1)
    expect(first.pagination).toMatchObject({ page: 1, limit: 1, total: 2, totalPages: 2, hasMore: true })
    const second = (await get(`/?search=${tag}-page-&limit=1&page=2`)).json()
    expect(second.data[0].id).not.toBe(first.data[0].id)
    expect(second.pagination.hasMore).toBe(false)
  })

  it("rejects an unknown filter value", async () => {
    expect((await get("/?segment=tout")).statusCode).toBe(400)
  })
})
