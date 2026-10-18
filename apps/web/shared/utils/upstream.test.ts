import { describe, expect, it } from "vitest"
import { upstreamHeaders } from "./upstream.js"

describe("upstreamHeaders (story 9.6)", () => {
  it("forwards the visitor's IP and marks the call as internal", () => {
    expect(upstreamHeaders("203.0.113.9", "s".repeat(40))).toEqual({
      "x-forwarded-for": "203.0.113.9",
      "x-internal-auth": "s".repeat(40),
    })
  })

  it("forwards the visitor's browser, not the Nuxt server's (story 12.7d)", () => {
    expect(upstreamHeaders("203.0.113.9", "", "Mozilla/5.0 (iPhone)")).toEqual({
      "x-forwarded-for": "203.0.113.9",
      "user-agent": "Mozilla/5.0 (iPhone)",
    })
  })

  it("sends nothing it does not have — never an empty secret or IP", () => {
    expect(upstreamHeaders(undefined, "")).toEqual({})
  })
})
