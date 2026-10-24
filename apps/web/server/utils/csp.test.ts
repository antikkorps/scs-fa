import { describe, expect, it } from "vitest"
import { contentSecurityPolicy, withDocumentNonce, withScriptNonce } from "./csp"

describe("contentSecurityPolicy", () => {
  it("trusts scripts by nonce, and what they load, rather than by host", () => {
    // A host allowlist can be bypassed through any script served by an allowed
    // origin; 'strict-dynamic' makes browsers ignore it in favour of the nonce.
    const scriptSrc = contentSecurityPolicy("abc123").match(/script-src [^;]*/)?.[0]
    expect(scriptSrc).toBe("script-src 'nonce-abc123' 'strict-dynamic' 'self' https://js.stripe.com 'unsafe-inline'")
  })

  it("keeps 'unsafe-inline' for styles (SSR-inlined component CSS and style bindings)", () => {
    expect(contentSecurityPolicy("n")).toContain("style-src 'self' 'unsafe-inline'")
  })

  it("allows no third-party font origin (fonts are self-hosted, story 10.7)", () => {
    const csp = contentSecurityPolicy("n")
    expect(csp).toContain("font-src 'self'")
    // Re-allowing Google Fonts would quietly reopen the GDPR exposure the
    // self-hosting removed: every visitor's IP handed to a third party.
    expect(csp).not.toContain("fonts.googleapis.com")
    expect(csp).not.toContain("fonts.gstatic.com")
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

  it("tags the links that fetch scripts: 'strict-dynamic' ignores 'self' for them", () => {
    const [preload, prefetch] = withScriptNonce(
      [
        '<link rel="modulepreload" as="script" crossorigin href="/_nuxt/a.js">',
        '<link rel="prefetch" as="script" crossorigin href="/_nuxt/b.js">',
      ],
      "N3",
    )
    expect(preload).toBe('<link nonce="N3" rel="modulepreload" as="script" crossorigin href="/_nuxt/a.js">')
    expect(prefetch).toBe('<link nonce="N3" rel="prefetch" as="script" crossorigin href="/_nuxt/b.js">')
  })

  it("leaves the links that fetch no script untouched", () => {
    const font = '<link rel="preload" as="font" crossorigin href="/_fonts/a.woff2">'
    const image = '<link rel="prefetch" as="image" type="image/svg+xml" href="/_nuxt/logo.svg">'
    expect(withScriptNonce([font, image], "N4")).toEqual([font, image])
  })

  it("leaves fragments without scripts unchanged", () => {
    expect(withScriptNonce(["<style>.a{}</style>", "<link rel=stylesheet>"], "Z")).toEqual([
      "<style>.a{}</style>",
      "<link rel=stylesheet>",
    ])
  })

  it("survives a module pushing arrays instead of strings into the head (story 9.6)", () => {
    // The PrimeVue module (since removed) pushed [] — every page 500'd.
    expect(withScriptNonce(["<script>a</script>", [], ["<script>b</script>"]], "Q")).toEqual([
      '<script nonce="Q">a</script>',
      '<script nonce="Q">b</script>',
    ])
  })
})

describe("withDocumentNonce (story 12.9g)", () => {
  const rendered = () => ({
    head: ['<script type="application/ld+json">{}</script>'],
    bodyPrepend: ["<script>prepended()</script>"],
    // The app's markup: rich text from the back office lands here through v-html.
    body: ['<div id="__nuxt"><article><script>alert(1)</script></article></div>'],
    bodyAppend: ['<script type="module" src="/_nuxt/entry.js"></script>'],
  })

  it("stamps the nonce on the scripts Nuxt renders around the app", () => {
    const html = withDocumentNonce(rendered(), "N")
    expect(html.head).toEqual(['<script nonce="N" type="application/ld+json">{}</script>'])
    expect(html.bodyPrepend).toEqual(['<script nonce="N">prepended()</script>'])
    expect(html.bodyAppend).toEqual(['<script nonce="N" type="module" src="/_nuxt/entry.js"></script>'])
  })

  it("never vouches for a script inside the app's own markup", () => {
    expect(withDocumentNonce(rendered(), "N").body.join("")).not.toContain("nonce")
  })
})
