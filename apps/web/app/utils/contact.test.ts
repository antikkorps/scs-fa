import { describe, expect, it } from "vitest"
import { telHref } from "./contact"

describe("telHref", () => {
  it("dials a French number in international form", () => {
    expect(telHref("04 78 00 00 00")).toBe("tel:+33478000000")
    expect(telHref("04.78.00.00.00")).toBe("tel:+33478000000")
  })

  it("keeps a number already international", () => {
    expect(telHref("+33 (0)4 78 00 00 00")).toBe("tel:+33478000000")
    expect(telHref("+49 9831 505-0")).toBe("tel:+4998315050")
  })
})
