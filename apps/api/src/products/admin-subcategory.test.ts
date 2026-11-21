import { like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { products } from "../db/schema.js"
import { createAccount, deleteAccounts, type TestAccount } from "../test/account-fixtures.js"

const SUFFIX = "@subcat-admin.test"
const PREFIX = "TESTSUBCAT-"
const BASE = "/api/admin/products"

// Story 12.15a — a product's subcategory, set from the back-office.
describe("admin products — subcategory", () => {
  let app: FastifyInstance
  let admin: TestAccount

  const asAdmin = (method: "POST" | "PATCH", url: string, payload: Record<string, unknown>) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${admin.token}` }, payload })

  const create = (sku: string, extra: Record<string, unknown>) =>
    asAdmin("POST", BASE, {
      sku: `${PREFIX}${sku}`,
      slug: `testsubcat-${sku.toLowerCase()}`,
      name: "Carabine de test",
      categorySlug: "arme-longue",
      legalCategory: "C",
      priceHt: 800,
      ...extra,
    })

  async function cleanup() {
    await db.delete(products).where(like(products.sku, `${PREFIX}%`))
    await deleteAccounts(SUFFIX)
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()
    admin = await createAccount(app, SUFFIX, { role: "admin" })
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it("files a product under a subcategory of its category", async () => {
    const res = await create("1", { subcategorySlug: "carabines" })
    expect(res.statusCode).toBe(201)
    expect(res.json().data).toMatchObject({ subcategorySlug: "carabines", subcategoryName: "Carabines" })
  })

  it("leaves the subcategory empty when none is given", async () => {
    const res = await create("2", {})
    expect(res.statusCode).toBe(201)
    expect(res.json().data.subcategorySlug).toBeNull()
  })

  it("refuses a subcategory of another category", async () => {
    const res = await create("3", { subcategorySlug: "munitions-canon-raye" })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toContain("munitions-canon-raye")
  })

  it("changes, then clears, the subcategory", async () => {
    const { id } = (await create("4", { subcategorySlug: "carabines" })).json().data
    const changed = await asAdmin("PATCH", `${BASE}/${id}`, { subcategorySlug: "fusils" })
    expect(changed.json().data.subcategorySlug).toBe("fusils")
    const cleared = await asAdmin("PATCH", `${BASE}/${id}`, { subcategorySlug: null })
    expect(cleared.json().data.subcategorySlug).toBeNull()
  })

  // The old subcategory belongs to the old category: kept, the database would refuse the pair.
  it("drops the subcategory when the category changes without a new one", async () => {
    const { id } = (await create("5", { subcategorySlug: "carabines" })).json().data
    const res = await asAdmin("PATCH", `${BASE}/${id}`, { categorySlug: "munition" })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ categorySlug: "munition", subcategorySlug: null })
  })

  it("takes a new category and its subcategory together", async () => {
    const { id } = (await create("6", { subcategorySlug: "carabines" })).json().data
    const res = await asAdmin("PATCH", `${BASE}/${id}`, {
      categorySlug: "munition",
      subcategorySlug: "munitions-canon-lisse",
    })
    expect(res.json().data).toMatchObject({ categorySlug: "munition", subcategorySlug: "munitions-canon-lisse" })
  })

  it("refuses a subcategory that does not fit the product's current category", async () => {
    const { id } = (await create("7", {})).json().data
    const res = await asAdmin("PATCH", `${BASE}/${id}`, { subcategorySlug: "dagues" })
    expect(res.statusCode).toBe(400)
  })
})
