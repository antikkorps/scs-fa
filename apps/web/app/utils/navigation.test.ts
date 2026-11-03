import { describe, expect, it } from "vitest"
import { authReturnQuery, loginForCartPath, safeInternalPath } from "./navigation"

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

// UX audit 2026-11-01 (I3): a visitor without an account who clicks "add to
// cart" must find the item in the cart after logging in or signing up.
describe("loginForCartPath", () => {
  it("sends the visitor to the login with the page and the item to add as the way back", () => {
    expect(loginForCartPath("/boutique/fusil-x", { ajouter: "v2" })).toBe(
      "/connexion?redirect=%2Fboutique%2Ffusil-x%3Fajouter%3Dv2&motif=panier",
    )
  })
})

describe("authReturnQuery", () => {
  it("keeps the way back and the reason when moving between login and sign-up", () => {
    expect(authReturnQuery({ redirect: "/boutique/fusil-x?ajouter=v2", motif: "panier", other: "x" })).toEqual({
      redirect: "/boutique/fusil-x?ajouter=v2",
      motif: "panier",
    })
  })

  it("drops a way back that leaves the site, and an unknown reason", () => {
    expect(authReturnQuery({ redirect: "//evil.com", motif: "autre" })).toEqual({})
  })

  it("keeps nothing when there is nothing to keep", () => {
    expect(authReturnQuery({})).toEqual({})
  })
})
