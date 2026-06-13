import { describe, expect, it } from "vitest"
import {
  calculateOrderPaymentSplit,
  PAYMENT_SPLIT,
  requiresVirement,
  VIREMENT_REF_ALPHABET,
  virementReferenceFromBytes,
} from "./orders.js"

describe("requiresVirement", () => {
  it("requires a bank transfer for regulated categories A/B/C", () => {
    expect(requiresVirement("A")).toBe(true)
    expect(requiresVirement("B")).toBe(true)
    expect(requiresVirement("C")).toBe(true)
  })

  it("allows card payment for D, unregulated and missing categories", () => {
    expect(requiresVirement("D")).toBe(false)
    expect(requiresVirement("none")).toBe(false)
    expect(requiresVirement(null)).toBe(false)
    expect(requiresVirement(undefined)).toBe(false)
  })
})

describe("virementReferenceFromBytes", () => {
  it("formats SCS-XXXX-XXXX from Crockford base32 symbols", () => {
    // byte % 32 → indices 0,1,2,3,4,5,6,7 → "0","1","2","3","4","5","6","7"
    const ref = virementReferenceFromBytes(Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]))
    expect(ref).toBe("SCS-0123-4567")
  })

  it("maps bytes through the alphabet modulo 32 (wraps past 31)", () => {
    // 32 % 32 = 0 → "0", 255 % 32 = 31 → last symbol "Z"
    const ref = virementReferenceFromBytes(Uint8Array.from([32, 255, 32, 255, 32, 255, 32, 255]))
    expect(ref).toBe(`SCS-${"0Z0Z"}-${"0Z0Z"}`)
  })

  it("only emits characters from the Crockford alphabet (no I/L/O/U)", () => {
    const ref = virementReferenceFromBytes(Uint8Array.from([100, 200, 50, 7, 19, 240, 3, 88]))
    expect(ref).toMatch(/^SCS-[0-9A-Z]{4}-[0-9A-Z]{4}$/)
    for (const ch of ref.replace(/SCS-|-/g, "")) {
      expect(VIREMENT_REF_ALPHABET).toContain(ch)
    }
    expect(ref).not.toMatch(/[ILOU]/)
  })

  it("throws when given fewer than 8 bytes of entropy", () => {
    expect(() => virementReferenceFromBytes(Uint8Array.from([1, 2, 3]))).toThrow(/8 bytes/)
  })
})

describe("calculateOrderPaymentSplit", () => {
  it("classifies an order with only regulated firearms as virement_only", () => {
    const split = calculateOrderPaymentSplit([{ priceHt: 1000, vatPct: 20, requiresPaymentVirement: true }])
    expect(split.splitType).toBe(PAYMENT_SPLIT.VIREMENT_ONLY)
    expect(split.virement.amountTtc).toBe(1200)
    expect(split.carte.amountTtc).toBe(0)
  })

  it("classifies an accessory-only order as carte_only", () => {
    const split = calculateOrderPaymentSplit([{ priceHt: 50, vatPct: 20, requiresPaymentVirement: false }])
    expect(split.splitType).toBe(PAYMENT_SPLIT.CARTE_ONLY)
    expect(split.carte.amountTtc).toBe(60)
    expect(split.virement.amountTtc).toBe(0)
  })

  it("splits a mixed order into both buckets", () => {
    const split = calculateOrderPaymentSplit([
      { priceHt: 1000, vatPct: 20, requiresPaymentVirement: true },
      { priceHt: 50, vatPct: 20, requiresPaymentVirement: false },
      { priceHt: 100, vatPct: 20, requiresPaymentVirement: false },
    ])
    expect(split.splitType).toBe(PAYMENT_SPLIT.MIXED)
    expect(split.virement.amountTtc).toBe(1200)
    expect(split.carte.amountTtc).toBe(180)
  })
})
