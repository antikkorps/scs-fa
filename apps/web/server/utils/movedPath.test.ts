import { describe, expect, it } from "vitest"
import { movedPath } from "./movedPath"

// Story 12.15c-bis — Gun Art left /collection for /gun-art: « Collection » also
// named the armes de collection (UI/UX review of 12.15c). The old addresses,
// already indexed and shared, move for good to the new ones.
describe("movedPath", () => {
  it("moves the gallery and every page under it", () => {
    expect(movedPath("/collection")).toBe("/gun-art")
    expect(movedPath("/collection/eclat")).toBe("/gun-art/eclat")
    expect(movedPath("/collection/serie/age-d-or")).toBe("/gun-art/serie/age-d-or")
    expect(movedPath("/collection/artiste")).toBe("/gun-art/artiste")
  })

  it("leaves every other address alone", () => {
    expect(movedPath("/gun-art")).toBeNull()
    expect(movedPath("/armes-de-collection")).toBeNull()
    expect(movedPath("/collections")).toBeNull()
    expect(movedPath("/boutique/collection")).toBeNull()
  })
})
