import { describe, expect, it } from "vitest"
import {
  artworkGeometry,
  artworkImage,
  availabilityLabel,
  fallbackImage,
  formatCountdown,
  formatDate,
  formatDateTime,
  formatEuros,
  formatNumber,
  formatPercent,
  plural,
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

describe("formatPercent", () => {
  // fr-FR: decimal comma, narrow no-break space before the sign
  it("formats a percentage (0–100) the French way", () => {
    expect(formatPercent(66.67).replace(/\s/g, " ")).toBe("66,67 %")
    expect(formatPercent(30).replace(/\s/g, " ")).toBe("30 %")
  })

  it("rounds to two decimals at most", () => {
    expect(formatPercent(12.3456).replace(/\s/g, " ")).toBe("12,35 %")
  })

  it("returns an em dash for null/undefined/NaN", () => {
    expect(formatPercent(null)).toBe("—")
    expect(formatPercent(undefined)).toBe("—")
    expect(formatPercent(Number.NaN)).toBe("—")
  })
})

describe("formatNumber", () => {
  it("uses a decimal comma and groups thousands (fr-FR)", () => {
    expect(formatNumber(12.5)).toBe("12,5")
    expect(formatNumber(1234.5).replace(/\s/g, " ")).toBe("1 234,5")
  })

  it("returns an em dash for null/undefined/NaN", () => {
    expect(formatNumber(null)).toBe("—")
    expect(formatNumber(Number.NaN)).toBe("—")
  })
})

describe("artwork images", () => {
  it("builds a self-contained inline-SVG placeholder (no network)", () => {
    const out = fallbackImage("acier-nocturne", 800, 1000)
    expect(out.startsWith("data:image/svg+xml,")).toBe(true)
    const svg = decodeURIComponent(out.replace("data:image/svg+xml,", ""))
    expect(svg).toContain('width="800"')
    expect(svg).toContain('height="1000"')
  })

  it("is deterministic for a given seed and size", () => {
    expect(fallbackImage("acier-nocturne", 800, 1000)).toBe(fallbackImage("acier-nocturne", 800, 1000))
  })

  it("prefers the backend image when present, falls back otherwise", () => {
    expect(artworkImage("https://cdn.example/x.jpg", "slug").src).toBe("https://cdn.example/x.jpg")
    expect(artworkImage(null, "slug", 400, 500).src).toBe(fallbackImage("slug", 400, 500))
    expect(artworkImage("", "slug", 400, 500).src).toBe(fallbackImage("slug", 400, 500))
  })

  it("carries the placeholder even when an image exists — it is needed when that one fails", () => {
    expect(artworkImage("https://cdn.example/x.jpg", "slug", 400, 500).fallback).toBe(fallbackImage("slug", 400, 500))
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

describe("formatCountdown (story 12.9a)", () => {
  it("shows minutes and two-digit seconds", () => {
    expect(formatCountdown(29 * 60_000 + 5_000)).toBe("29:05")
    expect(formatCountdown(61_000)).toBe("1:01")
  })

  it("rounds up to the second, and never goes below zero", () => {
    expect(formatCountdown(500)).toBe("0:01")
    expect(formatCountdown(0)).toBe("0:00")
    expect(formatCountdown(-3_000)).toBe("0:00")
  })
})

describe("plural", () => {
  it("agrees with the number, French style", () => {
    expect(plural(1, "produit")).toBe("1 produit")
    expect(plural(0, "produit")).toBe("0 produit")
    expect(plural(1200, "produit")).toMatch(/^1\s200 produits$/)
    expect(plural(2, "nouveau fournisseur", "nouveaux fournisseurs")).toBe("2 nouveaux fournisseurs")
  })
})
