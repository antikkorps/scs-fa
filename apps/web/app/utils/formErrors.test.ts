import { loginSchema, registerSchema } from "@armurier/shared"
import { describe, expect, it } from "vitest"
import { apiErrorCode, apiErrorField, authErrorStatus, zodFieldErrors } from "./formErrors"

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

describe("apiErrorCode", () => {
  it("reads the API error code carried by a fetch error", () => {
    expect(apiErrorCode({ data: { error: "TermsOutdated" } })).toBe("TermsOutdated")
  })

  it("returns undefined for anything else", () => {
    expect(apiErrorCode(new Error("boom"))).toBeUndefined()
    expect(apiErrorCode(null)).toBeUndefined()
  })
})

describe("apiErrorField", () => {
  it("reads a detail the API sends next to its error code", () => {
    const err = { response: { status: 401 }, data: { error: "InvalidLoginCode", remainingAttempts: 2 } }
    expect(apiErrorField<number>(err, "remainingAttempts")).toBe(2)
  })

  it("reads it through the BFF auth routes too, which wrap the API's body", () => {
    const err = {
      response: { status: 401 },
      data: { error: true, statusCode: 401, data: { error: "InvalidLoginCode", remainingAttempts: 4 } },
    }
    expect(apiErrorCode(err)).toBe("InvalidLoginCode")
    expect(apiErrorField<number>(err, "remainingAttempts")).toBe(4)
  })

  it("is undefined when the detail, or the body, is missing", () => {
    expect(apiErrorField({ data: { error: "X" } }, "remainingAttempts")).toBeUndefined()
    expect(apiErrorField(new Error("network"), "remainingAttempts")).toBeUndefined()
  })
})
