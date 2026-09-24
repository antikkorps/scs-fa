import { describe, expect, it } from "vitest"
import { EDITORIAL_PAGES, reviewedEditorialPaths } from "./editorialPages"

describe("editorial pages (story 9.6)", () => {
  it("keeps a page the client has not validated out of the sitemap", () => {
    const paths = reviewedEditorialPaths()
    for (const page of Object.values(EDITORIAL_PAGES)) {
      expect(paths.includes(page.path)).toBe(page.reviewed)
    }
  })
})
