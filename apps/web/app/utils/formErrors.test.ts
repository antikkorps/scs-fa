import { loginSchema, registerSchema } from "@armurier/shared"
import { describe, expect, it } from "vitest"
import { authErrorStatus, zodFieldErrors } from "./formErrors"

describe("zodFieldErrors", () => {
  it("maps failing fields to French messages", () => {
    const parsed = loginSchema.safeParse({ email: "nope", password: "" })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    const errors = zodFieldErrors(parsed.error)
    expect(errors.email).toBe("Adresse email invalide.")
  })

  it("flags a missing RGPD consent on register", () => {
    const parsed = registerSchema.safeParse({
      email: "buyer@example.com",
      password: "longenoughpassword",
      firstName: "Jean",
      lastName: "Dupont",
      rgpdConsent: false,
    })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    const errors = zodFieldErrors(parsed.error)
    expect(errors.rgpdConsent).toBe("Vous devez accepter la politique de confidentialité.")
  })

  it("keeps only the first message per field", () => {
    const parsed = loginSchema.safeParse({ email: "", password: "" })
    if (parsed.success) return
    const errors = zodFieldErrors(parsed.error)
    expect(typeof errors.email).toBe("string")
  })
})

describe("authErrorStatus", () => {
  it("extracts the HTTP status from a fetch error", () => {
    expect(authErrorStatus({ response: { status: 423 } })).toBe(423)
  })

  it("returns undefined when there is no response", () => {
    expect(authErrorStatus(new Error("boom"))).toBeUndefined()
    expect(authErrorStatus(null)).toBeUndefined()
  })
})
