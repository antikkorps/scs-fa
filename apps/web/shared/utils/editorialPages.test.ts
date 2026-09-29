import { describe, expect, it } from "vitest"
import { EDITORIAL_PAGES, IDENTITY_PAGES, reviewedEditorialPaths } from "./editorialPages"
import { LEGAL_IDENTITY, missingLegalFacts } from "./legalIdentity"

describe("editorial pages (story 9.6)", () => {
  it("keeps a page the client has not validated out of the sitemap", () => {
    const paths = reviewedEditorialPaths()
    for (const page of Object.values(EDITORIAL_PAGES)) {
      expect(paths.includes(page.path)).toBe(page.reviewed)
    }
  })
})

describe("legal identity (story 12.1)", () => {
  it("refuses to publish a legal page while a fact about the seller is missing", () => {
    const missing = missingLegalFacts()
    for (const key of IDENTITY_PAGES) {
      if (EDITORIAL_PAGES[key].reviewed) expect(missing, `${key} is marked reviewed`).toEqual([])
    }
  })

  it("lists exactly the facts not supplied yet", () => {
    expect(missingLegalFacts({ ...LEGAL_IDENTITY, siret: "123" })).not.toContain("siret")
    expect(missingLegalFacts({ ...LEGAL_IDENTITY, siret: "" })).toContain("siret")
  })
})
