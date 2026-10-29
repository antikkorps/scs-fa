import { describe, expect, it } from "vitest"
import { isPageRequest, showsWaitingPage } from "./launch"

describe("showsWaitingPage", () => {
  const closed = { stage: "coming_soon", adminPreview: false } as const

  it.each(["/", "/boutique", "/boutique/carabine-x", "/collection", "/connexion", "/inscription", "/cgv"])(
    "hides %s behind the waiting page before the opening",
    (path) => {
      expect(showsWaitingPage({ ...closed, path })).toBe(true)
    },
  )

  it.each([
    "/admin",
    "/admin/login",
    "/admin/reglages",
    "/mentions-legales",
    "/confidentialite",
    "/newsletter/confirmation",
    "/newsletter/desabonnement",
  ])("lets %s through: the back-office, the legal pages and the newsletter links", (path) => {
    expect(showsWaitingPage({ ...closed, path })).toBe(false)
  })

  it("does not mistake a lookalike path for an allowed one", () => {
    expect(showsWaitingPage({ ...closed, path: "/administration" })).toBe(true)
    expect(showsWaitingPage({ ...closed, path: "/mentions-legales-bis" })).toBe(true)
    expect(showsWaitingPage({ ...closed, path: "/newsletter" })).toBe(true)
  })

  it("lets a signed-in administrator through everywhere", () => {
    expect(showsWaitingPage({ stage: "coming_soon", adminPreview: true, path: "/boutique" })).toBe(false)
  })

  it.each(["showcase", "open"] as const)("shows every page once the stage is %s", (stage) => {
    expect(showsWaitingPage({ stage, adminPreview: false, path: "/boutique" })).toBe(false)
  })
})

describe("isPageRequest", () => {
  it.each(["/", "/boutique/carabine-x", "/admin/reglages"])("treats GET %s as a page", (path) => {
    expect(isPageRequest("GET", path)).toBe(true)
    expect(isPageRequest("HEAD", path)).toBe(true)
  })

  it("ignores everything that is not a page render", () => {
    expect(isPageRequest("POST", "/boutique")).toBe(false)
    expect(isPageRequest("GET", "/bff/api/cart")).toBe(false)
    expect(isPageRequest("GET", "/api/products")).toBe(false)
    expect(isPageRequest("GET", "/_nuxt/entry.js")).toBe(false)
    expect(isPageRequest("GET", "/__nuxt_error")).toBe(false)
    expect(isPageRequest("GET", "/sitemap.xml")).toBe(false)
    expect(isPageRequest("GET", "/favicon.ico")).toBe(false)
  })

  it("ignores the query string", () => {
    expect(isPageRequest("GET", "/recherche?q=a.b")).toBe(true)
  })
})
