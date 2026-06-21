import { describe, expect, it } from "vitest"
import {
  blogArticleCreateSchema,
  blogArticleUpdateSchema,
  blogQuerySchema,
  cartItemSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
} from "./validation.js"

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

  it("accepts optional deviceLabel", () => {
    const r = loginSchema.safeParse({
      email: "jean@example.fr",
      password: "x",
      deviceLabel: "MacBook Pro",
    })
    expect(r.success).toBe(true)
  })
})

describe("refreshSchema", () => {
  it("rejects short tokens", () => {
    expect(refreshSchema.safeParse({ refreshToken: "short" }).success).toBe(false)
  })

  it("accepts a 32-byte base64url-like token", () => {
    expect(refreshSchema.safeParse({ refreshToken: "a".repeat(43) }).success).toBe(true)
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

describe("blogArticleCreateSchema", () => {
  const base = { slug: "histoire-du-luger-p08", title: "Histoire du Luger P08", content: "<p>Texte.</p>" }

  it("accepts a minimal valid post and defaults published/featured to false", () => {
    const r = blogArticleCreateSchema.safeParse(base)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.published).toBe(false)
      expect(r.data.featured).toBe(false)
    }
  })

  it("rejects an invalid slug, empty content and unknown keys", () => {
    expect(blogArticleCreateSchema.safeParse({ ...base, slug: "Pas Valide" }).success).toBe(false)
    expect(blogArticleCreateSchema.safeParse({ ...base, content: "" }).success).toBe(false)
    expect(blogArticleCreateSchema.safeParse({ ...base, authorId: "x" }).success).toBe(false)
  })

  it("rejects a non-URL featured image", () => {
    expect(blogArticleCreateSchema.safeParse({ ...base, featuredImageUrl: "not-a-url" }).success).toBe(false)
  })
})

describe("blogArticleUpdateSchema", () => {
  it("accepts a partial update", () => {
    expect(blogArticleUpdateSchema.safeParse({ published: true }).success).toBe(true)
  })

  it("rejects an empty object", () => {
    expect(blogArticleUpdateSchema.safeParse({}).success).toBe(false)
  })
})

describe("blogQuerySchema", () => {
  it("coerces the published string to a boolean and defaults pagination", () => {
    const r = blogQuerySchema.safeParse({ published: "true" })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.published).toBe(true)
      expect(r.data.page).toBe(1)
      expect(r.data.limit).toBe(20)
    }
  })

  it("rejects a non-boolean published filter", () => {
    expect(blogQuerySchema.safeParse({ published: "maybe" }).success).toBe(false)
  })
})
