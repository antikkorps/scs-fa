import { describe, expect, it } from "vitest"
import { isLegalDocExpired, parisToday } from "./legal-documents.js"

describe("parisToday (story 12.9f)", () => {
  it("gives the calendar date in Paris, not in UTC", () => {
    // 23:30 UTC on 31 January is already 1 February in Paris (UTC+1).
    expect(parisToday(new Date("2026-01-31T23:30:00Z"))).toBe("2026-02-01")
    expect(parisToday(new Date("2026-07-14T10:00:00Z"))).toBe("2026-07-14")
  })
})

describe("isLegalDocExpired (story 12.9f)", () => {
  it("keeps a document valid through its expiry day", () => {
    expect(isLegalDocExpired("2026-10-22", "2026-10-22")).toBe(false)
    expect(isLegalDocExpired("2026-10-21", "2026-10-22")).toBe(true)
  })

  it("never expires a document without an expiry date", () => {
    expect(isLegalDocExpired(null, "2026-10-22")).toBe(false)
    expect(isLegalDocExpired(undefined, "2026-10-22")).toBe(false)
  })
})
