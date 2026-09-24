import { describe, expect, it } from "vitest"
import { META_DESCRIPTION_MAX, metaDescription } from "./seoText"

describe("metaDescription (story 9.6)", () => {
  it("leaves a description that fits untouched, whitespace aside", () => {
    expect(metaDescription("  Un   tirage\nd'art. ")).toBe("Un tirage d'art.")
  })

  it("strips markup that slipped in from a rich-text field", () => {
    expect(metaDescription("<p>Un <strong>tirage</strong></p>")).toBe("Un tirage")
  })

  it("cuts a long one on a word boundary, within the limit, with an ellipsis", () => {
    const long =
      "SCS Firearm réunit une armurerie de précision — armes, munitions, optiques et accessoires encadrés par la réglementation française — et Gun Art, des tirages d'art en édition limitée, signés, numérotés et certifiés."
    const out = metaDescription(long)
    expect(out.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX)
    expect(out.endsWith("…")).toBe(true)
    expect(long.startsWith(out.slice(0, -1))).toBe(true)
    expect(out).not.toMatch(/[\s,—]…$/)
  })
})
