import { describe, expect, it } from "vitest"
import { cartItemSchema, loginSchema, registerSchema } from "./validation.js"

describe("registerSchema", () => {
  const base = {
    email: "jean@example.fr",
    password: "MotDePasseTresLong123",
    firstName: "Jean",
    lastName: "Dupont",
    rgpdConsent: true as const,
  }

  it("accepts valid input", () => {
    expect(registerSchema.safeParse(base).success).toBe(true)
  })

  it("accepts optional phone", () => {
    expect(registerSchema.safeParse({ ...base, phone: "+33 6 12 34 56 78" }).success).toBe(true)
  })

  it("rejects short password (<12)", () => {
    expect(registerSchema.safeParse({ ...base, password: "court1" }).success).toBe(false)
  })

  it("rejects invalid email", () => {
    expect(registerSchema.safeParse({ ...base, email: "pas-un-email" }).success).toBe(false)
  })

  it("rejects missing RGPD consent", () => {
    const { rgpdConsent: _omit, ...withoutConsent } = base
    expect(registerSchema.safeParse(withoutConsent).success).toBe(false)
  })

  it("rejects rgpdConsent=false", () => {
    expect(registerSchema.safeParse({ ...base, rgpdConsent: false }).success).toBe(false)
  })

  it("rejects malformed phone", () => {
    expect(registerSchema.safeParse({ ...base, phone: "abc-def" }).success).toBe(false)
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
