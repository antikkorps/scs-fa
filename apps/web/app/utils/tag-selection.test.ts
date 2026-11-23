import { describe, expect, it } from "vitest"
import { pickInFacet } from "./tag-selection"

// Story 12.15e: the calibre is chosen from a drop-down, one at a time — the
// new choice replaces the facet's previous one and leaves the others alone.
describe("pickInFacet", () => {
  const facetOf = new Map([
    ["calibre-12", "calibre"],
    ["calibre-20", "calibre"],
    ["occasion", "etat"],
  ])

  it("replaces the facet's previous choice, keeping the other facets' tags", () => {
    expect(pickInFacet(["occasion", "calibre-12"], facetOf, "calibre", "calibre-20")).toEqual([
      "occasion",
      "calibre-20",
    ])
  })

  it("drops the facet's choice when none is picked", () => {
    expect(pickInFacet(["calibre-12", "occasion"], facetOf, "calibre", "")).toEqual(["occasion"])
  })
})
