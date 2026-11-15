import { describe, expect, it } from "vitest"
import { pagedTitle, pageFromQuery, pagerItems } from "./pagination"

describe("pageFromQuery", () => {
  it("reads a positive page number, and falls back to the first page", () => {
    expect(pageFromQuery("3")).toBe(3)
    expect(pageFromQuery(undefined)).toBe(1)
    expect(pageFromQuery("0")).toBe(1)
    expect(pageFromQuery("-2")).toBe(1)
    expect(pageFromQuery("abc")).toBe(1)
    expect(pageFromQuery(["2", "5"])).toBe(1)
  })
})

describe("pagedTitle (SEO audit 2026-11-15, finding 13)", () => {
  it("keeps the first page's title, and numbers the later ones so no two pages share a title", () => {
    expect(pagedTitle("Boutique armurerie", 1)).toBe("Boutique armurerie")
    expect(pagedTitle("Boutique armurerie", 3)).toBe("Boutique armurerie — page 3")
  })
})

describe("pagerItems (SEO audit 2026-11-15, finding 1)", () => {
  it("lists every page when there are few", () => {
    expect(pagerItems(2, 5)).toEqual([1, 2, 3, 4, 5])
  })

  it("keeps the first, the last and the neighbours of the current page, with gaps between", () => {
    expect(pagerItems(1, 20)).toEqual([1, 2, "gap", 20])
    expect(pagerItems(10, 20)).toEqual([1, "gap", 9, 10, 11, "gap", 20])
    expect(pagerItems(20, 20)).toEqual([1, "gap", 19, 20])
  })

  it("does not hide a single page behind a gap", () => {
    expect(pagerItems(4, 20)).toEqual([1, 2, 3, 4, 5, "gap", 20])
  })
})
