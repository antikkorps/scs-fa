import { eq, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { legalCategories, productCategories, products } from "../db/schema.js"

const SKU_PREFIX = "TEST22-"

async function categoryId(slug: string): Promise<string> {
  const [row] = await db
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(eq(productCategories.slug, slug))
    .limit(1)
  if (!row) throw new Error(`Missing seeded product category: ${slug} (run db:seed)`)
  return row.id
}

async function legalCategoryId(code: "A" | "B" | "C" | "D" | "none"): Promise<string> {
  const [row] = await db
    .select({ id: legalCategories.id })
    .from(legalCategories)
    .where(eq(legalCategories.category, code))
    .limit(1)
  if (!row) throw new Error(`Missing seeded legal category: ${code} (run db:seed)`)
  return row.id
}

describe("GET /api/products/:id", () => {
  let app: FastifyInstance
  let publishedId: string
  let accessoryId: string
  let unpublishedId: string

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()

    await db.delete(products).where(like(products.sku, `${SKU_PREFIX}%`))

    const armePoing = await categoryId("arme-poing")
    const accessoire = await categoryId("accessoire-tireur")
    const legalB = await legalCategoryId("B")
    const legalNone = await legalCategoryId("none")

    const inserted = await db
      .insert(products)
      .values([
        {
          sku: `${SKU_PREFIX}alpha`,
          slug: `${SKU_PREFIX}alpha`,
          name: "Pistolet Test Alpha",
          description: "Un pistolet de compétition très précis",
          longDescription: "Description longue détaillée du pistolet Alpha",
          categoryId: armePoing,
          legalCategoryId: legalB,
          priceHt: "800.00",
          ageMinRequired: 18,
          requiresLegalVerification: true,
          published: true,
        },
        {
          sku: `${SKU_PREFIX}gamma`,
          slug: `${SKU_PREFIX}gamma`,
          name: "Accessoire Test Gamma",
          description: "Tapis de nettoyage",
          categoryId: accessoire,
          legalCategoryId: legalNone,
          priceHt: "25.00",
          requiresLegalVerification: false,
          published: true,
        },
        {
          sku: `${SKU_PREFIX}delta`,
          slug: `${SKU_PREFIX}delta`,
          name: "Produit Test Delta caché",
          description: "Produit non publié",
          categoryId: accessoire,
          legalCategoryId: legalNone,
          priceHt: "50.00",
          requiresLegalVerification: false,
          published: false,
        },
      ])
      .returning({ id: products.id, sku: products.sku })

    const idOf = (sku: string): string => {
      const found = inserted.find((p) => p.sku === sku)
      if (!found) throw new Error(`Inserted product not found: ${sku}`)
      return found.id
    }

    publishedId = idOf(`${SKU_PREFIX}alpha`)
    accessoryId = idOf(`${SKU_PREFIX}gamma`)
    unpublishedId = idOf(`${SKU_PREFIX}delta`)
  })

  afterAll(async () => {
    await db.delete(products).where(like(products.sku, `${SKU_PREFIX}%`))
    await app.close()
  })

  it("returns 200 with the full product detail", async () => {
    const res = await app.inject({ method: "GET", url: `/api/products/${publishedId}` })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({
      id: publishedId,
      sku: `${SKU_PREFIX}alpha`,
      slug: `${SKU_PREFIX}alpha`,
      name: "Pistolet Test Alpha",
      longDescription: "Description longue détaillée du pistolet Alpha",
      requiresLegalVerification: true,
      ageMinRequired: 18,
    })
    expect(body.category).toMatchObject({ slug: "arme-poing", name: "Armes de poing" })
    expect(body.seo).toBeDefined()
  })

  it("computes priceTtc from priceHt and vat", async () => {
    const res = await app.inject({ method: "GET", url: `/api/products/${publishedId}` })
    const body = res.json()
    expect(body.priceHt).toBe(800)
    expect(body.vatPct).toBe(20)
    expect(body.priceTtc).toBe(960)
  })

  it("returns the full legal category object", async () => {
    const res = await app.inject({ method: "GET", url: `/api/products/${publishedId}` })
    const body = res.json()
    expect(body.legalCategory).toMatchObject({
      category: "B",
      requiresVerification: true,
      minAge: 18,
    })
    expect(Array.isArray(body.legalCategory.requiredDocTypes)).toBe(true)
  })

  it("returns 200 for a product in the unregulated legal category", async () => {
    const res = await app.inject({ method: "GET", url: `/api/products/${accessoryId}` })
    expect(res.statusCode).toBe(200)
    expect(res.json().legalCategory).toMatchObject({ category: "none" })
  })

  it("returns 404 for an unpublished product", async () => {
    const res = await app.inject({ method: "GET", url: `/api/products/${unpublishedId}` })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe("NotFound")
  })

  it("returns 404 for an unknown product id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/products/00000000-0000-0000-0000-000000000000",
    })
    expect(res.statusCode).toBe(404)
  })

  it("returns 400 for a non-UUID id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/products/not-a-uuid" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe("ValidationError")
  })
})
