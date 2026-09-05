import { describe, expect, it } from "vitest"
import { originMatchesHost } from "./csrf"

describe("originMatchesHost", () => {
  it("accepts a same-origin request", () => {
    expect(originMatchesHost("https://www.scs-firearms.com", "www.scs-firearms.com")).toBe(true)
    expect(originMatchesHost("http://localhost:3000", "localhost:3000")).toBe(true)
  })

  it("rejects a cross-origin request", () => {
    expect(originMatchesHost("https://evil.com", "www.scs-firearms.com")).toBe(false)
    expect(originMatchesHost("http://localhost:3001", "localhost:3000")).toBe(false)
  })

  it("allows a missing Origin (SSR / non-browser, not a cross-site attack)", () => {
    expect(originMatchesHost(undefined, "www.scs-firearms.com")).toBe(true)
  })

  it("rejects a malformed Origin", () => {
    expect(originMatchesHost("not-a-url", "www.scs-firearms.com")).toBe(false)
  })
})
