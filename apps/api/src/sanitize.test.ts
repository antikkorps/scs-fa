import { describe, expect, it } from "vitest"
import { sanitizeRichTextHtml } from "./sanitize.js"

describe("sanitizeRichTextHtml", () => {
  it("strips scripts and event handlers", () => {
    expect(sanitizeRichTextHtml('<p onclick="x()">Bonjour<script>alert(1)</script></p>')).toBe("<p>Bonjour</p>")
  })

  // SEO audit 2026-11-15, finding 4: nofollow on every link meant the journal
  // passed nothing to the product pages it links to.
  describe("links", () => {
    it("leaves a link to the site's own pages followed, without rel or target", () => {
      expect(sanitizeRichTextHtml('<a href="/boutique/carabine" target="_blank" rel="nofollow">la carabine</a>')).toBe(
        '<a href="/boutique/carabine">la carabine</a>',
      )
      expect(sanitizeRichTextHtml('<a href="https://www.scs-firearms.com/collection/x">x</a>')).toBe(
        '<a href="https://www.scs-firearms.com/collection/x">x</a>',
      )
      expect(sanitizeRichTextHtml('<a href="https://scs-firearms.com/blog">blog</a>')).toBe(
        '<a href="https://scs-firearms.com/blog">blog</a>',
      )
    })

    it("hardens a link to another site", () => {
      expect(sanitizeRichTextHtml('<a href="https://example.org/" target="_blank">source</a>')).toBe(
        '<a href="https://example.org/" target="_blank" rel="noopener noreferrer nofollow">source</a>',
      )
    })

    it("does not take a protocol-relative or look-alike host for the site", () => {
      expect(sanitizeRichTextHtml('<a href="//evil.example/x">x</a>')).toContain('rel="noopener noreferrer nofollow"')
      expect(sanitizeRichTextHtml('<a href="https://scs-firearms.com.evil.example/">x</a>')).toContain(
        'rel="noopener noreferrer nofollow"',
      )
    })

    it("still drops a javascript: link target", () => {
      expect(sanitizeRichTextHtml('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>")
    })
  })
})
