import { and, eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { artists, artworks, auditLogs, products, suppliers } from "../db/schema.js"
import { createAccount, deleteAccounts, type TestAccount } from "../test/account-fixtures.js"

const SUFFIX = "@bulk-archive.test"
const BASE = "/api/admin/products"
const PREFIX = "TESTBULKARCH-"
const SUPPLIER = "Fournisseur test archivage"

// Story 12.16b: Fred imports a supplier's whole catalogue (1 800 lines) and
// could only archive it one product at a time.
describe("archiving products in bulk", () => {
  let app: FastifyInstance
  let admin: TestAccount
  let customer: TestAccount

  const asAdmin = (method: "GET" | "POST", url: string, payload?: object) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${admin.token}` }, payload })

  async function createProduct(name: string): Promise<string> {
    const res = await asAdmin("POST", BASE, {
      sku: `${PREFIX}${name}`,
      slug: `testbulkarch-${name.toLowerCase()}`,
      name,
      categorySlug: "aide-visee",
      legalCategory: "none",
      priceHt: 50,
      published: true,
    })
    expect(res.statusCode, res.body).toBe(201)
    return res.json().data.id
  }

  async function cleanup() {
    await db.delete(artworks).where(like(artworks.sku, `${PREFIX}%`))
    await db.delete(products).where(like(products.sku, `${PREFIX}%`))
    await db.delete(suppliers).where(eq(suppliers.name, SUPPLIER))
    await deleteAccounts(SUFFIX)
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()
    admin = await createAccount(app, SUFFIX, { role: "admin" })
    customer = await createAccount(app, SUFFIX)
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it("is for admins only", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${BASE}/archive`,
      headers: { authorization: `Bearer ${customer.token}` },
      payload: { ids: [] },
    })
    expect(res.statusCode).toBe(403)
  })

  it.each([[{ ids: [] }], [{ ids: ["pas-un-uuid"] }], [{}]])("refuses %o", async (payload) => {
    expect((await asAdmin("POST", `${BASE}/archive`, payload)).statusCode).toBe(400)
  })

  it("takes the listed products off sale, logs each one, and counts only what changed", async () => {
    const first = await createProduct("Un")
    const second = await createProduct("Deux")
    await asAdmin("POST", `${BASE}/${second}/archive`)
    const unknown = "00000000-0000-4000-8000-000000000000"

    const res = await asAdmin("POST", `${BASE}/archive`, { ids: [first, second, unknown] })

    expect(res.statusCode, res.body).toBe(200)
    expect(res.json().data).toEqual({ archived: 1 })
    const [row] = await db.select().from(products).where(eq(products.id, first))
    expect(row).toMatchObject({ published: false })
    expect(row?.archivedAt).toBeTruthy()
    const events = await db
      .select({ entityId: auditLogs.entityId })
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "product.archived"), inArray(auditLogs.entityId, [first, second])))
    expect(events.map((event) => event.entityId).sort()).toEqual([first, second].sort())
  })

  // A Gun Art piece is archived from its own screen, which knows its edition.
  it("leaves alone a product that backs a Gun Art piece", async () => {
    const id = await createProduct("Oeuvre")
    const [artist] = await db.select({ id: artists.id }).from(artists).limit(1)
    if (!artist) throw new Error("the demo seed brings an artist")
    await db.insert(artworks).values({
      productId: id,
      slug: "testbulkarch-oeuvre",
      sku: `${PREFIX}OEUVRE`,
      title: "Tirage test",
      artistId: artist.id,
      editionLimit: 10,
      availableFormats: [{ id: "A4", name: "A4", widthCm: 21, heightCm: 29.7, priceFactor: 1 }],
      basePriceHt: "300.00",
      priceIncrementHt: "10.00",
      vatPct: "20",
      orientation: "square",
    })

    const res = await asAdmin("POST", `${BASE}/archive`, { ids: [id] })

    expect(res.json().data).toEqual({ archived: 0 })
    const [row] = await db.select().from(products).where(eq(products.id, id))
    expect(row?.archivedAt).toBeNull()
  })

  it("lists each product's supplier, so the list can be narrowed to one", async () => {
    const id = await createProduct("Fourni")
    const [supplier] = await db.insert(suppliers).values({ name: SUPPLIER }).returning({ id: suppliers.id })
    await db.update(products).set({ supplierId: supplier?.id }).where(eq(products.id, id))

    const listed = (await asAdmin("GET", BASE)).json().data.find((item: { id: string }) => item.id === id)

    expect(listed).toMatchObject({ supplierName: SUPPLIER })
  })
})
