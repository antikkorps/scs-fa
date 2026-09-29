import { describe, expect, it } from "vitest"
import { LEGAL_IDENTITY } from "./legal-identity.js"
import { escapeHtml, renderTermsHtml, renderTermsText, TERMS_SECTIONS } from "./terms-content.js"

const siteUrl = "https://scs.example"

describe("terms content (story 12.1)", () => {
  it("renders every section and the withdrawal form as text", () => {
    const text = renderTermsText({ siteUrl })
    for (const s of TERMS_SECTIONS) expect(text).toContain(s.title)
    expect(text).toContain("Je vous notifie par la présente ma rétractation")
  })

  it("turns site links into absolute URLs", () => {
    expect(renderTermsText({ siteUrl })).toContain("politique de confidentialité (https://scs.example/confidentialite)")
    expect(renderTermsHtml({ siteUrl })).toContain('<a href="https://scs.example/confidentialite">')
  })

  it("shows a missing legal fact as a placeholder, and the fact once supplied", () => {
    expect(renderTermsText({ siteUrl })).toContain("[raison sociale]")
    const identity = { ...LEGAL_IDENTITY, companyName: "SCS <Firearm> SAS" }
    expect(renderTermsText({ siteUrl, identity })).toContain("SCS <Firearm> SAS")
    expect(renderTermsHtml({ siteUrl, identity })).toContain("SCS &lt;Firearm&gt; SAS")
    expect(renderTermsHtml({ siteUrl })).toContain("<mark>[raison sociale]</mark>")
  })

  it("never leaves raw markup from the text in the HTML", () => {
    const html = renderTermsHtml({ siteUrl })
    expect(html).not.toMatch(/<(?!\/?(h3|p|ul|li|strong|em|a|mark)\b)[a-z]/i)
  })

  it("escapes HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;")
  })
})
