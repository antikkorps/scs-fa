import { describe, expect, it } from "vitest"
import {
  artworkGeometry,
  artworkImage,
  availabilityLabel,
  fallbackImage,
  formatDate,
  formatDateTime,
  formatEuros,
} from "./format.js"

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

describe("artworkGeometry", () => {
  it("returns a taller-than-wide ratio for portrait (the default)", () => {
    expect(artworkGeometry("portrait")).toEqual({ ratio: "4 / 5", width: 800, height: 1000 })
  })

  it("returns a wider-than-tall ratio for landscape", () => {
    const g = artworkGeometry("landscape")
    expect(g.ratio).toBe("3 / 2")
    expect(g.width).toBeGreaterThan(g.height)
  })

  it("returns a 1:1 ratio for square", () => {
    expect(artworkGeometry("square")).toEqual({ ratio: "1 / 1", width: 1000, height: 1000 })
  })
})

describe("date formatting", () => {
  it("formats an ISO date and date+time in fr-FR", () => {
    expect(formatDate("2026-06-14T10:30:00.000Z")).toContain("2026")
    expect(formatDateTime("2026-06-14T10:30:00.000Z")).toContain("2026")
  })

  it("returns an em dash for missing or invalid input", () => {
    expect(formatDate(null)).toBe("—")
    expect(formatDate(undefined)).toBe("—")
    expect(formatDate("not-a-date")).toBe("—")
    expect(formatDateTime("")).toBe("—")
    expect(formatDateTime("garbage")).toBe("—")
  })
})

describe("availabilityLabel", () => {
  it("describes the remaining edition", () => {
    expect(availabilityLabel(16, 25)).toBe("16 / 25 disponibles")
    expect(availabilityLabel(1, 25)).toBe("Dernier exemplaire")
    expect(availabilityLabel(0, 25)).toBe("Édition épuisée")
  })
})
