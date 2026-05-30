import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"

interface LegalCategoryDto {
  category: "A" | "B" | "C" | "D" | "none"
  name: string
  description: string | null
  requiresVerification: boolean
  minAge: number | null
  requiredDocTypes: string[]
}

describe("GET /api/legal-categories", () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it("returns 200 with the 5 seeded legal categories", async () => {
    const res = await app.inject({ method: "GET", url: "/api/legal-categories" })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { data: LegalCategoryDto[] }
    expect(Array.isArray(body.data)).toBe(true)
    const codes = body.data.map((c) => c.category)
    expect(codes).toEqual(["A", "B", "C", "D", "none"])
  })

  it("exposes the full reference shape for each category", async () => {
    const res = await app.inject({ method: "GET", url: "/api/legal-categories" })
    const body = res.json() as { data: LegalCategoryDto[] }
    const catB = body.data.find((c) => c.category === "B")
    expect(catB).toBeDefined()
    expect(catB).toMatchObject({
      category: "B",
      requiresVerification: true,
    })
    expect(typeof catB?.name).toBe("string")
    expect(Array.isArray(catB?.requiredDocTypes)).toBe(true)
  })

  it("marks the unregulated category as not requiring verification", async () => {
    const res = await app.inject({ method: "GET", url: "/api/legal-categories" })
    const body = res.json() as { data: LegalCategoryDto[] }
    const none = body.data.find((c) => c.category === "none")
    expect(none?.requiresVerification).toBe(false)
    expect(none?.requiredDocTypes).toEqual([])
  })
})
