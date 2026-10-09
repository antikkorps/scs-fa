import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, legalCategories, productCategories, products, suppliers, users } from "../db/schema.js"

const PASSWORD = "MotDePasseTresLong123!"
const BASE = "/api/admin/suppliers"
// Every supplier of this suite starts with the prefix, so cleanup is exact.
const PREFIX = "Testsupplier"

interface SupplierRow {
  id: string
  name: string
  contactEmail: string | null
  contactPhone: string | null
  products: number
}

describe("admin suppliers (story 12.5)", () => {
  let app: FastifyInstance
  let adminToken: string
  let customerToken: string

  async function cleanup() {
    const supplierIds = db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(like(suppliers.name, `${PREFIX}%`))
    await db.delete(products).where(inArray(products.supplierId, supplierIds))
    await db.delete(suppliers).where(like(suppliers.name, `${PREFIX}%`))
    const userIds = db.select({ id: users.id }).from(users).where(like(users.email, "testsupplier-%"))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
    await db.delete(users).where(like(users.email, "testsupplier-%"))
  }

  async function makeUser(email: string, role: "customer" | "admin") {
    const passwordHash = await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
    await db.insert(users).values({
      email,
      passwordHash,
      role,
      firstname: "Test",
      lastname: "Fournisseur",
      rgpdConsentAt: new Date(),
      rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
    })
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } })
    return login.json().accessToken as string
  }

  function asAdmin(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) {
    return app.inject({ method, url, payload, headers: { authorization: `Bearer ${adminToken}` } })
  }

  async function create(name: string, extra: object = {}): Promise<SupplierRow> {
    const res = await asAdmin("POST", BASE, { name, ...extra })
    expect(res.statusCode).toBe(201)
    return res.json().data
  }

  async function listed(name: string): Promise<SupplierRow | undefined> {
    const res = await asAdmin("GET", BASE)
    return (res.json().data as SupplierRow[]).find((supplier) => supplier.name === name)
  }

  async function giveProduct(supplierId: string, archived = false) {
    const [category] = await db
      .select({ id: productCategories.id })
      .from(productCategories)
      .where(eq(productCategories.slug, "arme-longue"))
    const [legal] = await db
      .select({ id: legalCategories.id })
      .from(legalCategories)
      .where(eq(legalCategories.category, "none"))
    if (!category || !legal) throw new Error("Missing seeded reference data (run db:seed)")
    const ref = `${PREFIX.toUpperCase()}-${crypto.randomUUID().slice(0, 8)}`
    await db.insert(products).values({
      sku: ref,
      slug: ref.toLowerCase(),
      name: "Article de test fournisseur",
      categoryId: category.id,
      legalCategoryId: legal.id,
      priceHt: "10.00",
      requiresLegalVerification: false,
      supplierId,
      supplierSku: ref,
      archivedAt: archived ? new Date() : null,
    })
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()
    adminToken = await makeUser("testsupplier-admin@testsupplier.local", "admin")
    customerToken = await makeUser("testsupplier-cust@testsupplier.local", "customer")
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it("refuses anyone but an admin", async () => {
    expect((await app.inject({ method: "GET", url: BASE })).statusCode).toBe(401)
    const asCustomer = await app.inject({
      method: "POST",
      url: BASE,
      payload: { name: `${PREFIX} Intrus` },
      headers: { authorization: `Bearer ${customerToken}` },
    })
    expect(asCustomer.statusCode).toBe(403)
  })

  it("creates a supplier and lists it, alphabetically, with its product count", async () => {
    await create(`${PREFIX} Zulu`)
    const alpha = await create(`${PREFIX} Alpha`, { contactEmail: "pro@alpha.example", contactPhone: "01 23 45 67 89" })
    await giveProduct(alpha.id)
    await giveProduct(alpha.id, true)

    const res = await asAdmin("GET", BASE)
    expect(res.statusCode).toBe(200)
    const mine = (res.json().data as SupplierRow[]).filter((supplier) => supplier.name.startsWith(PREFIX))
    expect(mine.map((supplier) => supplier.name)).toEqual([`${PREFIX} Alpha`, `${PREFIX} Zulu`])
    // Archived products still belong to the supplier: they count.
    expect(mine[0]).toMatchObject({ contactEmail: "pro@alpha.example", contactPhone: "01 23 45 67 89", products: 2 })
    expect(mine[1]?.products).toBe(0)
  })

  it("refuses a name already taken, whatever its case", async () => {
    const clash = await asAdmin("POST", BASE, { name: `${PREFIX.toLowerCase()} ZULU` })
    expect(clash.statusCode).toBe(409)
    expect(clash.json().message).toMatch(/existe déjà/)
    expect((await asAdmin("POST", BASE, { name: " " })).statusCode).toBe(400)
  })

  it("edits a supplier, never onto another one's name", async () => {
    const zulu = (await listed(`${PREFIX} Zulu`)) as SupplierRow
    const renamed = await asAdmin("PATCH", `${BASE}/${zulu.id}`, {
      name: `${PREFIX} Yankee`,
      contactEmail: "y@y.example",
    })
    expect(renamed.statusCode).toBe(200)
    expect(await listed(`${PREFIX} Yankee`)).toMatchObject({ id: zulu.id, contactEmail: "y@y.example" })

    // Fixing its own case is not a clash.
    expect((await asAdmin("PATCH", `${BASE}/${zulu.id}`, { name: `${PREFIX} YANKEE` })).statusCode).toBe(200)
    expect((await asAdmin("PATCH", `${BASE}/${zulu.id}`, { name: `${PREFIX} alpha` })).statusCode).toBe(409)
    expect((await asAdmin("PATCH", `${BASE}/${zulu.id}`, {})).statusCode).toBe(400)
    const unknown = await asAdmin("PATCH", `${BASE}/00000000-0000-4000-8000-000000000000`, {
      name: `${PREFIX} Fantôme`,
    })
    expect(unknown.statusCode).toBe(404)
  })

  it("deletes a supplier only while no product points at it", async () => {
    const alpha = (await listed(`${PREFIX} Alpha`)) as SupplierRow
    const refused = await asAdmin("DELETE", `${BASE}/${alpha.id}`)
    expect(refused.statusCode).toBe(409)
    expect(refused.json().message).toMatch(/2 produits/)

    const yankee = (await listed(`${PREFIX} YANKEE`)) as SupplierRow
    expect((await asAdmin("DELETE", `${BASE}/${yankee.id}`)).statusCode).toBe(204)
    expect(await listed(`${PREFIX} YANKEE`)).toBeUndefined()
    expect((await asAdmin("DELETE", `${BASE}/${yankee.id}`)).statusCode).toBe(404)
  })
})
