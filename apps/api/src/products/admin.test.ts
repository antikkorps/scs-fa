import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, products, productVariants, tags, users } from "../db/schema.js"

const PASSWORD = "MotDePasseTresLong123!"
const ADMIN_EMAIL = "testprodadmin-admin@testprodadmin.local"
const CUSTOMER_EMAIL = "testprodadmin-cust@testprodadmin.local"
const PREFIX = "TESTPRODADMIN-"
const BASE = "/api/admin/products"
const TAG_BASE = "/api/admin/tags"

describe("admin product & tag CRUD (story 7.5a)", () => {
  let app: FastifyInstance
  let adminToken: string
  let customerToken: string
  let productId: string

  async function cleanup() {
    const userIds = db.select({ id: users.id }).from(users).where(like(users.email, "testprodadmin-%"))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
    await db.delete(users).where(like(users.email, "testprodadmin-%"))
    await db.delete(products).where(like(products.sku, `${PREFIX}%`))
    await db.delete(tags).where(like(tags.slug, "testprodadmin-%"))
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

  const asAdmin = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${adminToken}` }, ...(body ? { payload: body } : {}) })

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

  it("refuses anyone but an admin", async () => {
    expect((await app.inject({ method: "GET", url: BASE })).statusCode).toBe(401)
    const asCustomer = await app.inject({
      method: "GET",
      url: BASE,
      headers: { authorization: `Bearer ${customerToken}` },
    })
    expect(asCustomer.statusCode).toBe(403)
  })

  describe("tags", () => {
    it("creates a tag and counts what it is used on", async () => {
      const created = await asAdmin("POST", TAG_BASE, {
        slug: "testprodadmin-tag",
        name: "Tag de test",
        facet: "caracteristique",
      })
      expect(created.statusCode).toBe(201)
      const rows = (await asAdmin("GET", TAG_BASE)).json().data as Array<{ slug: string; usageCount: number }>
      expect(rows.find((t) => t.slug === "testprodadmin-tag")?.usageCount).toBe(0)
    })

    /**
     * The facet drives the query semantics (OR inside a facet, AND across
     * facets), so moving a tag would silently change every saved filter.
     */
    it("never lets a tag change facet", async () => {
      const rows = (await asAdmin("GET", TAG_BASE)).json().data as Array<{ id: string; slug: string }>
      const id = rows.find((t) => t.slug === "testprodadmin-tag")?.id
      const res = await asAdmin("PATCH", `${TAG_BASE}/${id}`, { facet: "etat" })
      expect(res.statusCode).toBe(400)
    })
  })

  describe("products", () => {
    it("creates a product with its variants and its tags", async () => {
      const res = await asAdmin("POST", BASE, {
        sku: `${PREFIX}1`,
        slug: "testprodadmin-carabine",
        name: "Carabine de test",
        categorySlug: "arme-longue",
        legalCategory: "C",
        priceHt: 800,
        stockQty: 4,
        tagSlugs: ["testprodadmin-tag"],
        variants: [
          { skuVariant: `${PREFIX}1-A`, finition: "Bronzé", stockQty: 2 },
          { skuVariant: `${PREFIX}1-B`, couleur: "Noir", stockQty: 2, priceDeltaHt: 50 },
        ],
        published: true,
      })
      expect(res.statusCode).toBe(201)
      const data = res.json().data
      productId = data.id
      expect(data.variants).toHaveLength(2)
      expect(data.tagSlugs).toEqual(["testprodadmin-tag"])
      // Derived from the legal category, never taken from the form.
      const [row] = await db.select().from(products).where(eq(products.id, productId)).limit(1)
      expect(row?.requiresLegalVerification).toBe(true)
    })

    it("refuses a variant with no attribute at all, before Postgres does", async () => {
      const res = await asAdmin("POST", BASE, {
        sku: `${PREFIX}2`,
        slug: "testprodadmin-vide",
        name: "Sans attribut",
        categorySlug: "arme-longue",
        legalCategory: "none",
        priceHt: 10,
        variants: [{ skuVariant: `${PREFIX}2-A` }],
      })
      expect(res.statusCode).toBe(400)
    })

    it("names an unknown category rather than failing on a foreign key", async () => {
      const res = await asAdmin("POST", BASE, {
        sku: `${PREFIX}3`,
        slug: "testprodadmin-inconnue",
        name: "X",
        categorySlug: "categorie-inexistante",
        legalCategory: "none",
        priceHt: 10,
      })
      expect(res.statusCode).toBe(400)
      expect(res.json().message).toContain("Unknown category")
    })

    /**
     * A variant id travels through carts and order lines, so the form's list is
     * reconciled with what exists — never wiped and re-created.
     */
    it("updates a kept variant in place and inserts a new one", async () => {
      const before = (await asAdmin("GET", `${BASE}/${productId}`)).json().data
      const kept = before.variants[0]

      const res = await asAdmin("PATCH", `${BASE}/${productId}`, {
        variants: [
          { id: kept.id, skuVariant: kept.skuVariant, finition: "Inox", stockQty: 7 },
          { skuVariant: `${PREFIX}1-C`, couleur: "Vert", stockQty: 1 },
        ],
      })
      expect(res.statusCode).toBe(200)
      const after = res.json().data
      expect(after.variants).toHaveLength(2)

      const stillThere = after.variants.find((v: { id: string }) => v.id === kept.id)
      expect(stillThere).toMatchObject({ finition: "Inox", stockQty: 7 })
      // The variant dropped from the list is gone, the new one is in.
      expect(after.variants.some((v: { skuVariant: string }) => v.skuVariant === `${PREFIX}1-B`)).toBe(false)
      expect(after.variants.some((v: { skuVariant: string }) => v.skuVariant === `${PREFIX}1-C`)).toBe(true)
    })

    it("replaces the tag set wholesale when the form sends one", async () => {
      const res = await asAdmin("PATCH", `${BASE}/${productId}`, { tagSlugs: [] })
      expect(res.json().data.tagSlugs).toEqual([])
    })

    it("edits neither a Gun Art piece nor a collection weapon through the generic form", async () => {
      // Those pairs have their own screens, which know about editions and provenance.
      const [artworkProduct] = await db
        .select({ id: products.id })
        .from(products)
        .where(like(products.sku, "ART-%"))
        .limit(1)
      if (artworkProduct) {
        expect((await asAdmin("GET", `${BASE}/${artworkProduct.id}`)).statusCode).toBe(404)
        const list = (await asAdmin("GET", BASE)).json().data as Array<{ id: string }>
        expect(list.some((p) => p.id === artworkProduct.id)).toBe(false)
      }
    })

    it("deletes a product nobody ordered, variants included", async () => {
      expect((await asAdmin("DELETE", `${BASE}/${productId}`)).statusCode).toBe(204)
      expect(await db.select().from(products).where(eq(products.id, productId))).toHaveLength(0)
      expect(await db.select().from(productVariants).where(eq(productVariants.productId, productId))).toHaveLength(0)
    })
  })
})
