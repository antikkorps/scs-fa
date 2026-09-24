import { describe, expect, it } from "vitest"
import { canonicalPath } from "./canonicalPath"

describe("canonicalPath (story 9.6)", () => {
  it("drops a trailing slash", () => {
    expect(canonicalPath("/boutique/")).toBe("/boutique")
    expect(canonicalPath("/collection/serie/age-d-or//")).toBe("/collection/serie/age-d-or")
  })

  it("lower-cases a path typed or linked in capitals", () => {
    expect(canonicalPath("/BOUTIQUE/Glock-17")).toBe("/boutique/glock-17")
  })

  it("leaves a canonical path alone — including an escaped accent", () => {
    expect(canonicalPath("/boutique")).toBeNull()
    expect(canonicalPath("/")).toBeNull()
    expect(canonicalPath("/boutique/luger-p08-dat%C3%A9-1917")).toBeNull()
  })

  it("keeps the accent escaped when it redirects", () => {
    expect(canonicalPath("/Boutique/luger-p08-dat%C3%A9-1917/")).toBe("/boutique/luger-p08-dat%C3%A9-1917")
  })

  it("never touches build assets, API or BFF paths, or files", () => {
    for (const p of [
      "/_nuxt/Bx1aQ.js",
      "/_fonts/Fraunces.woff2",
      "/api/Products",
      "/bff/api/Cart",
      "/og-default.png",
      "/Robots.txt",
    ]) {
      expect(canonicalPath(p), p).toBeNull()
    }
  })
})
