import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, blogPosts, users } from "../db/schema.js"

const PREFIX = "testblog-"
const PASSWORD = "MotDePasseTresLong123!"
const ADMIN_EMAIL = "testblog-admin@testblog.local"
const CUSTOMER_EMAIL = "testblog-cust@testblog.local"

describe("blog API (Story 9.4)", () => {
  let app: FastifyInstance
  let adminToken: string
  let adminId: string
  let customerToken: string

  async function cleanup() {
    const userIds = db.select({ id: users.id }).from(users).where(like(users.email, "testblog-%"))
    await db.delete(blogPosts).where(like(blogPosts.slug, `${PREFIX}%`))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
    await db.delete(users).where(like(users.email, "testblog-%"))
  }

  async function makeUser(email: string, role: "customer" | "admin") {
    const passwordHash = await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
    const [u] = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        role,
        firstname: "Test",
        lastname: role === "admin" ? "Admin" : "Client",
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id })
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } })
    return { id: u.id, token: login.json().accessToken as string }
  }

  async function seedPost(opts: { slug: string; title: string; published: boolean; publishedAt?: Date }) {
    await db.insert(blogPosts).values({
      slug: `${PREFIX}${opts.slug}`,
      title: opts.title,
      excerpt: "Un extrait.",
      content: "<p>Le corps de l'article.</p>",
      authorId: adminId,
      published: opts.published,
      publishedAt: opts.publishedAt ?? (opts.published ? new Date() : null),
    })
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()
    const admin = await makeUser(ADMIN_EMAIL, "admin")
    adminToken = admin.token
    adminId = admin.id
    customerToken = (await makeUser(CUSTOMER_EMAIL, "customer")).token
    await seedPost({ slug: "older", title: "Plus ancien", published: true, publishedAt: new Date("2026-01-01") })
    await seedPost({ slug: "newer", title: "Plus récent", published: true, publishedAt: new Date("2026-06-01") })
    await seedPost({ slug: "draft", title: "Brouillon", published: false })
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  const adminReq = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, token = adminToken, payload?: unknown) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: payload as object })

  describe("public GET /api/blog", () => {
    it("lists only published posts, newest-first, with author and pagination", async () => {
      const res = await app.inject({ method: "GET", url: "/api/blog?limit=100" })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      const mine = body.data.filter((p: { slug: string }) => p.slug.startsWith(PREFIX))
      expect(mine.map((p: { slug: string }) => p.slug)).toEqual([`${PREFIX}newer`, `${PREFIX}older`])
      expect(mine.some((p: { slug: string }) => p.slug === `${PREFIX}draft`)).toBe(false)
      expect(mine[0].authorName).toBe("Test Admin")
      expect(mine[0].content).toBeUndefined() // cards don't ship the body
      expect(body.pagination).toMatchObject({ page: 1, limit: 100 })
    })

    it("rejects a bad pagination query with 400", async () => {
      expect((await app.inject({ method: "GET", url: "/api/blog?limit=999" })).statusCode).toBe(400)
    })
  })

  describe("public GET /api/blog/:slug", () => {
    it("returns a published article with its content", async () => {
      const res = await app.inject({ method: "GET", url: `/api/blog/${PREFIX}newer` })
      expect(res.statusCode).toBe(200)
      const data = res.json().data
      expect(data.title).toBe("Plus récent")
      expect(data.content).toContain("<p>")
      expect(data.authorName).toBe("Test Admin")
    })

    it("404s on a draft and on an unknown slug", async () => {
      expect((await app.inject({ method: "GET", url: `/api/blog/${PREFIX}draft` })).statusCode).toBe(404)
      expect((await app.inject({ method: "GET", url: "/api/blog/does-not-exist" })).statusCode).toBe(404)
    })
  })

  describe("admin auth", () => {
    it("rejects a customer with 403 and an anonymous caller with 401", async () => {
      expect((await adminReq("GET", "/api/admin/blog", customerToken)).statusCode).toBe(403)
      expect((await app.inject({ method: "GET", url: "/api/admin/blog" })).statusCode).toBe(401)
    })
  })

  describe("admin GET /api/admin/blog", () => {
    it("lists all posts (incl. drafts) with pagination", async () => {
      const res = await adminReq("GET", "/api/admin/blog?limit=100")
      expect(res.statusCode).toBe(200)
      const slugs = res.json().data.map((p: { slug: string }) => p.slug)
      expect(slugs).toContain(`${PREFIX}draft`)
    })

    it("filters by published and by search", async () => {
      const drafts = await adminReq("GET", "/api/admin/blog?published=false&limit=100")
      expect(drafts.json().data.every((p: { published: boolean }) => p.published === false)).toBe(true)
      const search = await adminReq("GET", `/api/admin/blog?search=${PREFIX}newer&limit=100`)
      expect(search.json().data.some((p: { slug: string }) => p.slug === `${PREFIX}newer`)).toBe(true)
    })

    it("400s on an invalid published filter", async () => {
      expect((await adminReq("GET", "/api/admin/blog?published=maybe")).statusCode).toBe(400)
    })
  })

  describe("admin create / update / delete", () => {
    it("creates a published post, stamping author and publishedAt", async () => {
      const res = await adminReq("POST", "/api/admin/blog", adminToken, {
        slug: `${PREFIX}created`,
        title: "Créé",
        content: "<p>x</p>",
        published: true,
      })
      expect(res.statusCode).toBe(201)
      const data = res.json().data
      expect(data.authorId).toBe(adminId)
      expect(data.publishedAt).not.toBeNull()
    })

    it("rejects an invalid body (400) and a duplicate slug (409)", async () => {
      expect((await adminReq("POST", "/api/admin/blog", adminToken, { slug: "x", title: "" })).statusCode).toBe(400)
      const dup = await adminReq("POST", "/api/admin/blog", adminToken, {
        slug: `${PREFIX}created`,
        title: "Doublon",
        content: "<p>y</p>",
      })
      expect(dup.statusCode).toBe(409)
    })

    it("patches a post; unpublishing clears publishedAt", async () => {
      const created = await adminReq("POST", "/api/admin/blog", adminToken, {
        slug: `${PREFIX}toggle`,
        title: "Bascule",
        content: "<p>z</p>",
        published: true,
      })
      const id = created.json().data.id
      const patched = await adminReq("PATCH", `/api/admin/blog/${id}`, adminToken, { published: false })
      expect(patched.statusCode).toBe(200)
      expect(patched.json().data.publishedAt).toBeNull()
    })

    it("404s patching an unknown id and 400s on an empty body", async () => {
      const unknown = "00000000-0000-0000-0000-000000000000"
      expect((await adminReq("PATCH", `/api/admin/blog/${unknown}`, adminToken, { title: "x" })).statusCode).toBe(404)
      const real = await adminReq("POST", "/api/admin/blog", adminToken, {
        slug: `${PREFIX}empty`,
        title: "Vide",
        content: "<p>c</p>",
      })
      expect((await adminReq("PATCH", `/api/admin/blog/${real.json().data.id}`, adminToken, {})).statusCode).toBe(400)
    })

    it("deletes a post (204) and 404s on a second delete", async () => {
      const created = await adminReq("POST", "/api/admin/blog", adminToken, {
        slug: `${PREFIX}deleteme`,
        title: "À supprimer",
        content: "<p>d</p>",
      })
      const id = created.json().data.id
      expect((await adminReq("DELETE", `/api/admin/blog/${id}`)).statusCode).toBe(204)
      expect((await adminReq("DELETE", `/api/admin/blog/${id}`)).statusCode).toBe(404)
    })
  })
})
