import { EMPTY_SHOP_IDENTITY, LEGAL_FACT_KEYS, missingLegalFacts, type ShopIdentity } from "@armurier/shared"
import { describe, expect, it } from "vitest"
import { EDITORIAL_PAGES, isEditorialPagePublishable, publishableEditorialPaths } from "./editorialPages"

const COMPLETE: ShopIdentity = {
  ...EMPTY_SHOP_IDENTITY,
  ...Object.fromEntries(LEGAL_FACT_KEYS.map((key) => [key, `valeur ${key}`])),
}
const ALL_REVIEWED = Object.fromEntries(
  Object.entries(EDITORIAL_PAGES).map(([key, page]) => [key, { ...page, reviewed: true }]),
) as unknown as typeof EDITORIAL_PAGES

describe("editorial pages (story 9.6)", () => {
  it("keeps a page the client has not validated out of the sitemap", () => {
    const paths = publishableEditorialPaths(COMPLETE)
    for (const page of Object.values(EDITORIAL_PAGES)) {
      expect(paths.includes(page.path)).toBe(page.reviewed)
    }
  })
})

describe("legal identity (story 12.1, stored since the 2026-11-01 audit)", () => {
  it("keeps a validated legal page unpublished while a fact about the seller is missing", () => {
    const incomplete = { ...COMPLETE, siret: null }
    expect(missingLegalFacts(incomplete)).toEqual(["siret"])
    expect(isEditorialPagePublishable("mentionsLegales", incomplete, ALL_REVIEWED)).toBe(false)
    expect(isEditorialPagePublishable("cgv", incomplete, ALL_REVIEWED)).toBe(false)
    expect(isEditorialPagePublishable("confidentialite", incomplete, ALL_REVIEWED)).toBe(false)
    expect(publishableEditorialPaths(incomplete, ALL_REVIEWED)).toEqual(["/reglementation"])
  })

  it("publishes a validated page once the identity is complete", () => {
    expect(isEditorialPagePublishable("mentionsLegales", COMPLETE, ALL_REVIEWED)).toBe(true)
    expect(publishableEditorialPaths(COMPLETE, ALL_REVIEWED)).toHaveLength(4)
  })
})
