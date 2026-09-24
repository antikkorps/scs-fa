import { describe, expect, it } from "vitest"
import { REGULATION_FAQ, regulationFaqJsonLd } from "./regulationFaq"

describe("regulation FAQ (story 9.6)", () => {
  it("marks up every question the page shows, with the very same answer", () => {
    const ld = regulationFaqJsonLd()
    const entries = REGULATION_FAQ.flatMap((s) => s.entries)
    expect(ld["@type"]).toBe("FAQPage")
    expect(ld.mainEntity).toHaveLength(entries.length)
    expect(ld.mainEntity[0]).toEqual({
      "@type": "Question",
      name: entries[0]?.question,
      acceptedAnswer: { "@type": "Answer", text: entries[0]?.answer.join("\n\n") },
    })
  })

  it("never lets a point still to confirm leak into the structured data", () => {
    const json = JSON.stringify(regulationFaqJsonLd())
    for (const entry of REGULATION_FAQ.flatMap((s) => s.entries)) {
      if (entry.todo) expect(json).not.toContain(entry.todo)
    }
  })

  it("covers each category the shop sells, and the SIA", () => {
    const text = JSON.stringify(REGULATION_FAQ)
    for (const needle of ["catégorie B", "catégorie C", "Catégorie D", "SIA", "18 ans"]) {
      expect(text).toContain(needle)
    }
  })
})
