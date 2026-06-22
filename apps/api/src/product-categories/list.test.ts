import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"

interface CategoryRow {
  slug: string
  name: string
  category: string
  displayOrder: number | null
}

describe("GET /api/product-categories", () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it("returns the seeded armurerie categories, ordered by displayOrder", async () => {
    const res = await app.inject({ method: "GET", url: "/api/product-categories" })
    expect(res.statusCode).toBe(200)

    const body = res.json() as { data: CategoryRow[] }
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBeGreaterThan(0)

    const slugs = body.data.map((c) => c.slug)
    expect(slugs).toContain("arme-poing")
    expect(slugs).toContain("munition")

    const orders = body.data.map((c) => c.displayOrder ?? 0)
    const sorted = [...orders].sort((a, b) => a - b)
    expect(orders).toEqual(sorted)
  })

  it("excludes the gun_art category (it lives under /api/artworks)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/product-categories" })
    const body = res.json() as { data: CategoryRow[] }
    expect(body.data.some((c) => c.category === "gun_art")).toBe(false)
    expect(body.data.map((c) => c.slug)).not.toContain("gun-art")
  })
})
