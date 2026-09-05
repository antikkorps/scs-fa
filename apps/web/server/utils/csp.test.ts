import { describe, expect, it } from "vitest"
import { contentSecurityPolicy, withScriptNonce } from "./csp"

describe("contentSecurityPolicy", () => {
  it("allows inline scripts via the nonce and drops 'unsafe-inline' from script-src", () => {
    const csp = contentSecurityPolicy("abc123")
    expect(csp).toContain("script-src 'self' 'nonce-abc123' https://js.stripe.com")
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/)
  })

  it("keeps 'unsafe-inline' for styles (PrimeVue runtime injection)", () => {
    expect(contentSecurityPolicy("n")).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com")
  })

  it("allows the Stripe origins needed by the Payment Element", () => {
    const csp = contentSecurityPolicy("n")
    expect(csp).toContain("connect-src 'self' https://api.stripe.com https://m.stripe.network")
    expect(csp).toContain("frame-src https://js.stripe.com https://hooks.stripe.com")
  })

  it("keeps the clickjacking / injection lockdowns", () => {
    const csp = contentSecurityPolicy("n")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'self'")
  })
})

describe("withScriptNonce", () => {
  it("adds the nonce to an inline script", () => {
    expect(withScriptNonce(["<script>window.x=1</script>"], "N1")).toEqual(['<script nonce="N1">window.x=1</script>'])
  })

  it("tags external module and JSON-LD scripts too", () => {
    const [mod, ld] = withScriptNonce(
      ['<script type="module" src="/_nuxt/e.js"></script>', '<script type="application/ld+json">{}</script>'],
      "N2",
    )
    expect(mod).toContain('nonce="N2"')
    expect(ld).toContain('nonce="N2"')
  })

  it("is idempotent — never double-adds a nonce", () => {
    expect(withScriptNonce(['<script nonce="X">a</script>'], "Y")).toEqual(['<script nonce="X">a</script>'])
  })

  it("leaves fragments without scripts unchanged", () => {
    expect(withScriptNonce(["<style>.a{}</style>", "<link rel=stylesheet>"], "Z")).toEqual([
      "<style>.a{}</style>",
      "<link rel=stylesheet>",
    ])
  })
})
