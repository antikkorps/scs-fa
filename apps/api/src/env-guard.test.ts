import { describe, expect, it } from "vitest"
import { isSampleValue, sampleValueProblems } from "./env-guard.js"

const REAL = {
  JWT_SECRET: "q8Zr2vK1fLw9Xs0PmB4tY7nH3cJ6gD5aE1uR8iO2pQ9w",
  JWT_REFRESH_SECRET: "Lm3Nb8Vc1Xz7Qw4Er9Ty2Ui6Op0As5Df3Gh8Jk1Lz4x",
  DATABASE_URL: "postgresql://armurier:7f3c9a1e5b2d8f40@postgres:5432/armurier_prod",
  VIREMENT_IBAN: "FR7612345678901234567890123",
  PATH: "/usr/bin",
}

describe("isSampleValue (story 12.9b)", () => {
  it("recognises the placeholders of the committed examples", () => {
    for (const value of [
      "CHANGE-ME-very-long-secret-min-32-chars",
      "change-me-openssl-rand-hex-32",
      "AdminSCS-ChangeMe-2026!",
      "replace-me-with-a-very-long-secret-key-min-32-chars",
      "sk_live_your-stripe-secret-key",
      "whsec_your-webhook-signing-secret",
      "xkeysib-your-brevo-api-key",
    ]) {
      expect(isSampleValue(value), value).toBe(true)
    }
  })

  it("leaves real values alone", () => {
    expect(isSampleValue(REAL.JWT_SECRET)).toBe(false)
    expect(isSampleValue("sk_live_51Hx9")).toBe(false)
  })
})

describe("sampleValueProblems (story 12.9b)", () => {
  it("accepts a production environment with real values", () => {
    expect(sampleValueProblems(REAL)).toEqual([])
  })

  it("names every secret still holding a sample value, never the value", () => {
    const problems = sampleValueProblems({
      ...REAL,
      JWT_SECRET: "CHANGE-ME-very-long-secret-min-32-chars",
      BREVO_WEBHOOK_SECRET: "change-me-openssl-rand-hex-32",
      UMAMI_APP_SECRET: "CHANGE-ME-openssl-rand-hex-32",
      ADMIN_SEED_PASSWORD: "CHANGE-ME-strong-admin-password",
      S3_SECRET_KEY: "your-scw-secret-key",
    })
    expect(problems).toEqual([
      "JWT_SECRET",
      "BREVO_WEBHOOK_SECRET",
      "UMAMI_APP_SECRET",
      "ADMIN_SEED_PASSWORD",
      "S3_SECRET_KEY",
    ])
    expect(problems.join(" ")).not.toContain("CHANGE-ME")
  })

  it("catches the sample database password inside DATABASE_URL", () => {
    expect(
      sampleValueProblems({
        ...REAL,
        DATABASE_URL: "postgresql://armurier:CHANGE-ME-strong-db-password@postgres:5432/armurier_prod",
      }),
    ).toEqual(["DATABASE_URL"])
  })

  it("refuses the sample IBAN: customers would wire their money to it", () => {
    expect(sampleValueProblems({ ...REAL, VIREMENT_IBAN: "FR76 3000 6000 0112 3456 7890 189" })).toEqual([
      "VIREMENT_IBAN",
    ])
  })

  it("refuses the same secret for access and refresh tokens", () => {
    expect(sampleValueProblems({ ...REAL, JWT_REFRESH_SECRET: REAL.JWT_SECRET })).toEqual([
      "JWT_REFRESH_SECRET (same as JWT_SECRET)",
    ])
  })

  // Story 12.8e — the key of the authenticator secrets must not be the token key.
  it("refuses the JWT secret as the TOTP encryption key", () => {
    expect(sampleValueProblems({ ...REAL, TOTP_ENCRYPTION_KEY: REAL.JWT_SECRET })).toEqual([
      "TOTP_ENCRYPTION_KEY (same as JWT_SECRET)",
    ])
    expect(sampleValueProblems({ ...REAL, TOTP_ENCRYPTION_KEY: "CHANGE-ME-openssl-rand-base64-48" })).toEqual([
      "TOTP_ENCRYPTION_KEY",
    ])
  })

  it("ignores non-secret variables and empty optional secrets", () => {
    expect(sampleValueProblems({ ...REAL, ARTWORK_WATERMARK_TEXT: "your-brand", HENRRI_CLIENT_SECRET: "" })).toEqual([])
  })
})
