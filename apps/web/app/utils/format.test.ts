import { describe, expect, it } from "vitest"
import { artworkImage, availabilityLabel, fallbackImage, formatEuros } from "./format.js"

describe("formatEuros", () => {
  it("formats an amount in EUR (fr-FR)", () => {
    // fr-FR uses a narrow no-break space before the currency symbol
    expect(formatEuros(288).replace(/\s/g, " ")).toMatch(/^288,00\s€$/)
  })

  it("returns an em dash for null/undefined/NaN", () => {
    expect(formatEuros(null)).toBe("—")
    expect(formatEuros(undefined)).toBe("—")
    expect(formatEuros(Number.NaN)).toBe("—")
  })
})

describe("artwork images", () => {
  it("builds a deterministic placeholder from a seed", () => {
    expect(fallbackImage("acier-nocturne", 800, 1000)).toBe("https://picsum.photos/seed/acier-nocturne/800/1000")
  })

  it("prefers the backend image when present, falls back otherwise", () => {
    expect(artworkImage("https://cdn.example/x.jpg", "slug")).toBe("https://cdn.example/x.jpg")
    expect(artworkImage(null, "slug", 400, 500)).toBe("https://picsum.photos/seed/slug/400/500")
    expect(artworkImage("", "slug", 400, 500)).toBe("https://picsum.photos/seed/slug/400/500")
  })
})

describe("availabilityLabel", () => {
  it("describes the remaining edition", () => {
    expect(availabilityLabel(16, 25)).toBe("16 / 25 disponibles")
    expect(availabilityLabel(1, 25)).toBe("Dernier exemplaire")
    expect(availabilityLabel(0, 25)).toBe("Édition épuisée")
  })
})
