import { describe, expect, it } from "vitest"
import { fixC1, normaliseHeader, parseCsv } from "./csv.js"

describe("parseCsv", () => {
  it("detects a semicolon delimiter (French Excel export)", () => {
    expect(parseCsv("ref;prix\nA1;12,50\n")).toEqual([
      ["ref", "prix"],
      ["A1", "12,50"],
    ])
  })

  it("detects a comma delimiter", () => {
    expect(parseCsv("ref,price\nA1,12.50")).toEqual([
      ["ref", "price"],
      ["A1", "12.50"],
    ])
  })

  it("detects a tab delimiter", () => {
    expect(parseCsv("ref\tprice\nA1\t3")).toEqual([
      ["ref", "price"],
      ["A1", "3"],
    ])
  })

  it("ignores delimiters inside quotes when detecting", () => {
    // Three commas inside the quoted header, one semicolon outside.
    expect(parseCsv('"a,b,c,d";e\n1;2')[0]).toEqual(["a,b,c,d", "e"])
  })

  it("keeps line breaks inside quoted fields — a description spans several lines", () => {
    const rows = parseCsv('ref;description\nA1;"Ligne 1\nLigne 2"\nA2;simple')
    expect(rows).toEqual([
      ["ref", "description"],
      ["A1", "Ligne 1\nLigne 2"],
      ["A2", "simple"],
    ])
  })

  it("unescapes doubled quotes", () => {
    expect(parseCsv('a;b\n"Lunette 3""";x')[1]).toEqual(['Lunette 3"', "x"])
  })

  it("strips a UTF-8 BOM", () => {
    expect(parseCsv("\uFEFFref;prix\nA;1")[0]).toEqual(["ref", "prix"])
  })

  it("accepts CRLF and CR line endings", () => {
    expect(parseCsv("a;b\r\n1;2\r3;4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ])
  })

  it("keeps inner blank lines as empty rows so line numbers stay true, and trims fields", () => {
    expect(parseCsv("a;b\n\n  1 ; 2 \n\n")).toEqual([["a", "b"], [], ["1", "2"]])
  })

  it("keeps empty trailing fields so columns stay aligned", () => {
    expect(parseCsv("a;b;c\n1;;")[1]).toEqual(["1", "", ""])
  })

  it("keeps leading zeros — references are text, not numbers", () => {
    expect(parseCsv("ref\n00123")[1]).toEqual(["00123"])
  })

  it("returns nothing for an empty input", () => {
    expect(parseCsv("")).toEqual([])
    expect(parseCsv("\uFEFF\n\n")).toEqual([])
  })

  it("honours an explicit delimiter", () => {
    expect(parseCsv("a,b;c", { delimiter: ";" })).toEqual([["a,b", "c"]])
  })
})

describe("normaliseHeader", () => {
  it("drops accents, case, spaces and punctuation", () => {
    expect(normaliseHeader(" Prix d'achat HT (€) ")).toBe("prixdachatht")
    expect(normaliseHeader("Référence")).toBe("reference")
  })

  it("keeps digits so numbered columns stay distinct", () => {
    expect(normaliseHeader("Image 2")).toBe("image2")
  })
})

describe("fixC1", () => {
  it("repairs curly quotes stored as C1 control characters", () => {
    expect(fixC1("d\u0092autonomie \u0093ok\u0094 \u0080")).toBe("d’autonomie “ok” €")
  })
})
