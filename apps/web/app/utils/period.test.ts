import { describe, expect, it } from "vitest"
import { previousMonth } from "./period"

describe("previousMonth (default period of the accounting export)", () => {
  it("is the whole calendar month before today", () => {
    expect(previousMonth("2026-10-26")).toEqual({ from: "2026-09-01", to: "2026-09-30" })
    expect(previousMonth("2026-03-01")).toEqual({ from: "2026-02-01", to: "2026-02-28" })
    expect(previousMonth("2028-03-15")).toEqual({ from: "2028-02-01", to: "2028-02-29" })
  })

  it("steps back over the new year", () => {
    expect(previousMonth("2027-01-10")).toEqual({ from: "2026-12-01", to: "2026-12-31" })
  })
})
