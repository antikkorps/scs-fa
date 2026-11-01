import { describe, expect, it } from "vitest"
import { isStripeTestKey } from "./stripe"

describe("isStripeTestKey (UX audit 2026-11-01)", () => {
  it("recognises a test publishable key, the only one the test-card hint may show with", () => {
    expect(isStripeTestKey("pk_test_51Abc")).toBe(true)
  })

  it("never treats a live key, or no key, as test", () => {
    expect(isStripeTestKey("pk_live_51Abc")).toBe(false)
    expect(isStripeTestKey("")).toBe(false)
  })
})
