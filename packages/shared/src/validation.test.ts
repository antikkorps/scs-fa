import { describe, expect, it } from "vitest"
import { cartItemSchema, loginSchema, registerSchema } from "./validation.js"

describe("registerSchema", () => {
  it("accepts valid input", () => {
    const r = registerSchema.safeParse({
      email: "jean@example.fr",
      password: "MotDePasseTresLong123",
      firstName: "Jean",
      lastName: "Dupont",
    })
    expect(r.success).toBe(true)
  })

  it("rejects short password (<12)", () => {
    const r = registerSchema.safeParse({
      email: "jean@example.fr",
      password: "court1",
      firstName: "Jean",
      lastName: "Dupont",
    })
    expect(r.success).toBe(false)
  })

  it("rejects invalid email", () => {
    const r = registerSchema.safeParse({
      email: "pas-un-email",
      password: "MotDePasseTresLong123",
      firstName: "Jean",
      lastName: "Dupont",
    })
    expect(r.success).toBe(false)
  })
})

describe("loginSchema", () => {
  it("requires non-empty password", () => {
    const r = loginSchema.safeParse({ email: "jean@example.fr", password: "" })
    expect(r.success).toBe(false)
  })
})

describe("cartItemSchema", () => {
  it("requires exactly one of variantId / printId", () => {
    const both = cartItemSchema.safeParse({
      variantId: "00000000-0000-0000-0000-000000000000",
      printId: "00000000-0000-0000-0000-000000000001",
      qty: 1,
    })
    expect(both.success).toBe(false)

    const neither = cartItemSchema.safeParse({ qty: 1 })
    expect(neither.success).toBe(false)

    const variantOnly = cartItemSchema.safeParse({
      variantId: "00000000-0000-0000-0000-000000000000",
      qty: 1,
    })
    expect(variantOnly.success).toBe(true)
  })

  it("rejects qty <= 0 or > 10", () => {
    expect(cartItemSchema.safeParse({ variantId: "00000000-0000-0000-0000-000000000000", qty: 0 }).success).toBe(false)
    expect(cartItemSchema.safeParse({ variantId: "00000000-0000-0000-0000-000000000000", qty: 11 }).success).toBe(false)
  })
})
