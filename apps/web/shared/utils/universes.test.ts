import { describe, expect, it } from "vitest"
import { UNIVERSES, universePathForCategory, universePathForTag } from "./universes"

describe("universes (story 12.13)", () => {
  it("gives the knife category and the hunting tag a page of their own", () => {
    expect(universePathForCategory("coutellerie")).toBe("/coutellerie")
    expect(universePathForTag("chasse")).toBe("/chasse")
  })

  it("leaves every other category and tag on the shop's own pages", () => {
    expect(universePathForCategory("arme-longue")).toBeNull()
    expect(universePathForTag("occasion")).toBeNull()
    expect(universePathForCategory("chasse")).toBeNull()
    expect(universePathForTag("coutellerie")).toBeNull()
  })

  it("lists both universes for the menu, the sitemap and the agent files", () => {
    expect(UNIVERSES.map((universe) => universe.path)).toEqual(["/chasse", "/coutellerie"])
  })
})
