import { describe, expect, it } from "vitest"
import { safeInternalPath } from "./navigation"

describe("safeInternalPath", () => {
  it("keeps a normal internal path", () => {
    expect(safeInternalPath("/compte/commandes")).toBe("/compte/commandes")
    expect(safeInternalPath("/admin/orders?x=1")).toBe("/admin/orders?x=1")
  })

  it("rejects open-redirect payloads", () => {
    expect(safeInternalPath("https://evil.com")).toBe("/")
    expect(safeInternalPath("//evil.com")).toBe("/")
    expect(safeInternalPath("/\\evil.com")).toBe("/")
    expect(safeInternalPath("http:/evil")).toBe("/")
  })

  it("falls back for non-path or empty values", () => {
    expect(safeInternalPath(undefined)).toBe("/")
    expect(safeInternalPath("")).toBe("/")
    expect(safeInternalPath("relative/path")).toBe("/")
    expect(safeInternalPath(42)).toBe("/")
  })

  it("honours a custom fallback", () => {
    expect(safeInternalPath("//evil", "/connexion")).toBe("/connexion")
  })
})
