import { describe, expect, it } from "vitest"
import {
  amountsMatchToCent,
  calculateOrderPaymentSplit,
  extractTransferReference,
  PAYMENT_SPLIT,
  parseBankAmount,
  parseBankStatementCsv,
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

describe("extractTransferReference", () => {
  it("pulls the reference out of a free-form bank label", () => {
    expect(extractTransferReference("VIR SEPA SCS-0123-4567 JEAN TIREUR")).toBe("SCS-0123-4567")
  })

  it("normalises a lower-cased label reference to upper case", () => {
    expect(extractTransferReference("virement scs-ab12-cd34")).toBe("SCS-AB12-CD34")
  })

  it("returns null when no reference is present", () => {
    expect(extractTransferReference("VIR SEPA SANS REFERENCE")).toBeNull()
    // I/L/O/U are not in the Crockford alphabet → not a valid reference
    expect(extractTransferReference("SCS-ILOU-1234")).toBeNull()
  })
})

describe("parseBankAmount", () => {
  it("parses French formatting (comma decimal, space thousands)", () => {
    expect(parseBankAmount("1 234,56")).toBeCloseTo(1234.56, 2)
    expect(parseBankAmount("1200,00")).toBeCloseTo(1200, 2)
  })

  it("parses English formatting (dot decimal, comma thousands)", () => {
    expect(parseBankAmount("1,234.56")).toBeCloseTo(1234.56, 2)
    expect(parseBankAmount("1234.56")).toBeCloseTo(1234.56, 2)
  })

  it("tolerates a leading sign and currency symbol", () => {
    expect(parseBankAmount("+1200,00")).toBeCloseTo(1200, 2)
    expect(parseBankAmount("1 200,00 €")).toBeCloseTo(1200, 2)
  })

  it("returns NaN for unparseable input", () => {
    expect(Number.isNaN(parseBankAmount(""))).toBe(true)
    expect(Number.isNaN(parseBankAmount("abc"))).toBe(true)
  })
})

describe("amountsMatchToCent", () => {
  it("compares money to the cent, immune to float drift", () => {
    expect(amountsMatchToCent(0.1 + 0.2, 0.3)).toBe(true)
    expect(amountsMatchToCent(1200, 1200.0)).toBe(true)
    expect(amountsMatchToCent(1200, 1200.01)).toBe(false)
  })
})

describe("parseBankStatementCsv", () => {
  it("parses a semicolon-delimited French export with accented headers", () => {
    const csv = [
      "Date;Libellé;Montant;IBAN",
      "2026-06-10;VIR SCS-0123-4567 JEAN;1 200,00;FR7612345678901234567890123",
      "2026-06-11;ACHAT CB SUPERMARCHE;-45,90;",
    ].join("\n")
    const txns = parseBankStatementCsv(csv)
    expect(txns).toHaveLength(2)
    expect(txns[0]).toMatchObject({
      date: "2026-06-10",
      amount: 1200,
      counterpartyIban: "FR7612345678901234567890123",
    })
    expect(txns[0]?.label).toContain("SCS-0123-4567")
    expect(txns[1]?.amount).toBeCloseTo(-45.9, 2)
  })

  it("parses a comma-delimited English export and honours quoted fields", () => {
    const csv = ["date,description,amount", '2026-06-10,"VIR SCS-0123-4567, JEAN",1200.00'].join("\n")
    const txns = parseBankStatementCsv(csv)
    expect(txns).toHaveLength(1)
    expect(txns[0]?.label).toBe("VIR SCS-0123-4567, JEAN")
    expect(txns[0]?.amount).toBe(1200)
    expect(txns[0]?.counterpartyIban).toBeNull()
  })

  it("skips rows with an unparseable amount and returns [] for header-only input", () => {
    const csv = ["Libelle;Montant", "VIR SCS-0123-4567;n/a", "VIR SCS-AB12-CD34;500,00"].join("\n")
    const txns = parseBankStatementCsv(csv)
    expect(txns).toHaveLength(1)
    expect(txns[0]?.amount).toBe(500)
    expect(parseBankStatementCsv("Libelle;Montant")).toEqual([])
  })

  it("throws when no label/amount columns can be identified", () => {
    expect(() => parseBankStatementCsv("foo;bar\n1;2")).toThrow(/label and an amount/)
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
