import { describe, expect, it } from "vitest"
import { earliestHold } from "./cart.js"

describe("earliestHold (story 12.9a)", () => {
  it("is the first moment a held item goes back on sale", () => {
    expect(
      earliestHold({
        items: [{ heldUntil: null }, { heldUntil: "2026-10-22T10:20:00.000Z" }],
        artworkItems: [{ heldUntil: "2026-10-22T10:15:00.000Z" }],
      }),
    ).toBe("2026-10-22T10:15:00.000Z")
  })

  it("is null when nothing in the cart is held", () => {
    expect(earliestHold({ items: [{ heldUntil: null }], artworkItems: [] })).toBeNull()
  })
})
