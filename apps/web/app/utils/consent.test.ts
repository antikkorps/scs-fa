import { describe, expect, it } from "vitest"
import { CONSENT_VERSION, parseConsent, serializeConsent } from "./consent"

describe("consent cookie (story 9.6)", () => {
  it("round-trips a choice, dated", () => {
    const value = serializeConsent("granted", new Date("2026-09-24T10:00:00Z"))
    expect(value).toBe(`v${CONSENT_VERSION}.granted.2026-09-24`)
    expect(parseConsent(value)).toBe("granted")
    expect(parseConsent(serializeConsent("denied"))).toBe("denied")
  })

  it("asks again when there is no choice, a tampered one, or one from an older policy", () => {
    expect(parseConsent(undefined)).toBeNull()
    expect(parseConsent("")).toBeNull()
    expect(parseConsent("v1.maybe.2026-09-24")).toBeNull()
    expect(parseConsent(`v${CONSENT_VERSION - 1}.granted.2026-01-01`)).toBeNull()
  })
})
