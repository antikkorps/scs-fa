import { describe, expect, it } from "vitest"
import { tabsThatFit } from "./tab-overflow"

// Review of 12.15c (UI/UX): the universes share the row with the house's two
// signatures; those that do not fit go under « Plus », the rarest first since
// Fred orders the tabs from the best seller down.
describe("tabsThatFit", () => {
  it("keeps every tab when the whole row fits, with no room kept for « Plus »", () => {
    expect(tabsThatFit([100, 100, 100], 320, 60, 10)).toBe(3)
  })

  it("keeps the tabs that fit beside « Plus » once the row overflows", () => {
    // 100 + 10 + 100 + 10 + 60 = 280 fits, a third tab would need 390.
    expect(tabsThatFit([100, 100, 100, 100], 300, 60, 10)).toBe(2)
  })

  it("keeps none when even the first tab cannot sit beside « Plus »", () => {
    expect(tabsThatFit([200, 100], 220, 60, 10)).toBe(0)
  })

  it("keeps everything while the row is not laid out yet", () => {
    expect(tabsThatFit([0, 0], 0, 0, 0)).toBe(2)
    expect(tabsThatFit([], 500, 60, 10)).toBe(0)
  })
})
