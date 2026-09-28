import { describe, expect, it } from "vitest"
import {
  CATALOG_IMPORT_COLUMNS,
  type CollectedProduct,
  collectedProductSchema,
  normaliseEan,
  normaliseSupplierRef,
  parseCatalogImportTable,
  parseLegalCategory,
  proposeSalePriceHt,
  readPriceList,
  reconcileCatalog,
  slugify,
} from "./catalog-import.js"

const product = (over: Partial<CollectedProduct> = {}): CollectedProduct => ({
  supplier: "BGM Winfield",
  supplierSku: "AP-200",
  name: "Aimpoint Micro T-2",
  imageUrls: [],
  sourceUrl: "https://bgmwinfield.fr/p/1",
  specs: {},
  ...over,
})

describe("normaliseSupplierRef", () => {
  it("ignores case, spaces, dashes, dots, slashes and underscores", () => {
    expect(normaliseSupplierRef(" bk-01.a/b_c ")).toBe("BK01ABC")
    expect(normaliseSupplierRef("BK 01")).toBe(normaliseSupplierRef("bk-01"))
  })

  it("keeps leading zeros — 0123 and 123 are different references", () => {
    expect(normaliseSupplierRef("0123")).not.toBe(normaliseSupplierRef("123"))
  })
})

describe("normaliseEan", () => {
  it("accepts a valid EAN-13 and strips spaces", () => {
    expect(normaliseEan("4 006381 333931")).toBe("4006381333931")
  })

  it("accepts a valid EAN-8 and a UPC-A", () => {
    expect(normaliseEan("96385074")).toBe("96385074")
    expect(normaliseEan("036000291452")).toBe("036000291452")
  })

  it("rejects a wrong check digit, a wrong length or letters", () => {
    expect(normaliseEan("4006381333932")).toBeNull()
    expect(normaliseEan("12345")).toBeNull()
    expect(normaliseEan("ABC")).toBeNull()
    expect(normaliseEan("")).toBeNull()
  })

  it("reads an EAN that a spreadsheet turned into scientific notation back as null, not garbage", () => {
    expect(normaliseEan("4.00638E+12")).toBeNull()
  })
})

describe("proposeSalePriceHt", () => {
  it("applies the margin to the SELLING price, like the profitability report does", () => {
    // 30 % margin on price: 70 / (1 - 0.30) = 100, and 100 − 70 = 30 = 30 % of 100.
    expect(proposeSalePriceHt(70, 30)).toBe(100)
  })

  it("rounds to the cent", () => {
    expect(proposeSalePriceHt(10, 30)).toBe(14.29)
  })

  it("returns the cost itself for a zero margin and null for an impossible one", () => {
    expect(proposeSalePriceHt(50, 0)).toBe(50)
    expect(proposeSalePriceHt(50, 100)).toBeNull()
    expect(proposeSalePriceHt(50, -5)).toBeNull()
  })
})

describe("slugify", () => {
  it("builds a kebab-case slug without accents", () => {
    expect(slugify("Lunette Réglable 3-9×40 « Pro »")).toBe("lunette-reglable-3-9-40-pro")
  })

  it("caps the length without leaving a trailing dash", () => {
    const s = slugify(`${"a".repeat(10)} ${"b".repeat(10)}`, 12)
    expect(s).toBe("aaaaaaaaaa-b")
    expect(slugify("aaaaaaaaaa bbbb", 11)).toBe("aaaaaaaaaa")
  })
})

describe("readPriceList", () => {
  const mapping = { ref: "Référence", price: "Prix net HT", ean: "EAN" }

  it("finds the header row below title lines and reads refs as text", () => {
    const { rows, issues } = readPriceList(
      [
        ["TARIF REVENDEUR 2026"],
        ["", ""],
        ["Référence", "Désignation", "Prix net HT", "EAN"],
        ["00123", "Lampe", "12,50", "4006381333931"],
        ["BK-01", "Couteau", "1 234,00", ""],
      ],
      mapping,
    )
    expect(issues).toEqual([])
    expect(rows).toEqual([
      { line: 4, ref: "00123", price: 12.5, ean: "4006381333931" },
      { line: 5, ref: "BK-01", price: 1234, ean: null },
    ])
  })

  it("throws when the mapped columns are nowhere to be found", () => {
    expect(() => readPriceList([["a", "b"]], mapping)).toThrow(/Référence/)
  })

  it("reports unreadable prices and blank refs instead of guessing", () => {
    const { rows, issues } = readPriceList(
      [
        ["Référence", "Prix net HT"],
        ["A1", "sur demande"],
        ["", "10"],
        ["A2", "-3"],
      ],
      mapping,
    )
    expect(rows).toEqual([])
    expect(issues.map((i) => i.line)).toEqual([2, 3, 4])
  })
})

describe("reconcileCatalog", () => {
  it("matches on the normalised supplier reference", () => {
    const result = reconcileCatalog(
      [product({ supplierSku: "ap 200" })],
      [{ line: 2, ref: "AP-200", price: 300, ean: null }],
    )
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ status: "matched", matchedBy: "ref", price: { price: 300 } })
    expect(result.orphanPrices).toEqual([])
  })

  it("falls back on the EAN when the references differ", () => {
    const result = reconcileCatalog(
      [product({ supplierSku: "X-1", ean: "4006381333931" })],
      [{ line: 2, ref: "OTHER", price: 10, ean: "4006381333931" }],
    )
    expect(result.rows[0]).toMatchObject({ status: "matched", matchedBy: "ean" })
  })

  it("never guesses between two price lines carrying the same reference", () => {
    const result = reconcileCatalog(
      [product()],
      [
        { line: 2, ref: "AP-200", price: 300, ean: null },
        { line: 3, ref: "ap200", price: 310, ean: null },
      ],
    )
    expect(result.rows[0]).toMatchObject({ status: "ambiguous", price: null })
    // Neither line is lost: both are reported as prices without a product.
    expect(result.orphanPrices.map((p) => p.line)).toEqual([2, 3])
  })

  it("reports products without a price and prices without a product", () => {
    const result = reconcileCatalog([product({ supplierSku: "A" })], [{ line: 2, ref: "B", price: 5, ean: null }])
    expect(result.rows[0]).toMatchObject({ status: "no_price", price: null })
    expect(result.orphanPrices.map((p) => p.ref)).toEqual(["B"])
  })

  it("does not hand the same price line to two products", () => {
    const result = reconcileCatalog(
      [product({ supplierSku: "A", ean: "4006381333931" }), product({ supplierSku: "B", ean: "4006381333931" })],
      [{ line: 2, ref: "A", price: 5, ean: "4006381333931" }],
    )
    expect(result.rows.map((r) => r.status)).toEqual(["matched", "no_price"])
  })
})

describe("collectedProductSchema", () => {
  it("accepts a collector line and defaults the optional collections", () => {
    const parsed = collectedProductSchema.parse({
      supplier: "Toro",
      supplierSku: "T1",
      name: "Réplique",
      sourceUrl: "https://www.toro-distribution.com/p/1",
    })
    expect(parsed.imageUrls).toEqual([])
    expect(parsed.specs).toEqual({})
  })

  it("rejects a non-http image URL", () => {
    expect(
      collectedProductSchema.safeParse({
        supplier: "Toro",
        supplierSku: "T1",
        name: "x",
        sourceUrl: "https://a.fr",
        imageUrls: ["file:///etc/passwd"],
      }).success,
    ).toBe(false)
  })
})

describe("parseLegalCategory", () => {
  it("reads the letters and the French spellings of 'none'", () => {
    expect(parseLegalCategory("b")).toBe("B")
    expect(parseLegalCategory("Aucune")).toBe("none")
    expect(parseLegalCategory("libre")).toBe("none")
    expect(parseLegalCategory("none")).toBe("none")
  })

  it("never turns a blank or an unknown value into a category", () => {
    expect(parseLegalCategory("")).toBeNull()
    expect(parseLegalCategory("E")).toBeNull()
  })
})

describe("parseCatalogImportTable", () => {
  const header = CATALOG_IMPORT_COLUMNS.map((c) => c.header)
  const line = (values: Record<string, string>) => CATALOG_IMPORT_COLUMNS.map((c) => values[c.key] ?? "")

  const valid = {
    import: "oui",
    supplier: "BGM Winfield",
    supplierSku: "AP-200",
    name: "Aimpoint Micro T-2",
    category: "Aide à la visée",
    legalCategory: "Aucune",
    costPriceHt: "300",
    priceHt: "429,99",
  }

  it("parses a valid row and derives the missing SKU and slug", () => {
    const { rows, missingColumns } = parseCatalogImportTable([header, line(valid)])
    expect(missingColumns).toEqual([])
    expect(rows).toHaveLength(1)
    const [row] = rows
    expect(row?.status).toBe("valid")
    expect(row?.line).toBe(2)
    expect(row?.data).toMatchObject({
      supplier: "BGM Winfield",
      supplierSku: "AP-200",
      category: "Aide à la visée",
      legalCategory: "none",
      priceHt: 429.99,
      costPriceHt: 300,
      vatPct: 20,
      stockQty: 0,
      sku: "BGM-WINFIELD-AP200",
      slug: "aimpoint-micro-t-2-ap-200",
      imageUrls: [],
    })
  })

  it("skips rows not marked for import, without validating them", () => {
    const { rows } = parseCatalogImportTable([header, line({ ...valid, import: "non", name: "" })])
    expect(rows[0]?.status).toBe("skipped")
  })

  it("refuses a row whose legal category is blank — it is never guessed", () => {
    const { rows } = parseCatalogImportTable([header, line({ ...valid, legalCategory: "" })])
    expect(rows[0]?.status).toBe("invalid")
    expect(rows[0]?.errors.join(" ")).toMatch(/catégorie légale/i)
  })

  it("reports every problem of a row at once", () => {
    const { rows } = parseCatalogImportTable([
      header,
      line({ ...valid, priceHt: "gratuit", ean: "123", name: "", imageUrls: "ftp://x/y.jpg" }),
    ])
    expect(rows[0]?.status).toBe("invalid")
    expect(rows[0]?.errors.length).toBeGreaterThanOrEqual(4)
  })

  it("refuses a zero selling price", () => {
    const { rows } = parseCatalogImportTable([header, line({ ...valid, priceHt: "0" })])
    expect(rows[0]?.status).toBe("invalid")
  })

  it("splits the image cell on line breaks, pipes and spaces", () => {
    const { rows } = parseCatalogImportTable([
      header,
      line({ ...valid, imageUrls: "https://a.fr/1.jpg\nhttps://a.fr/2.jpg | https://a.fr/3.jpg" }),
    ])
    expect(rows[0]?.data?.imageUrls).toEqual(["https://a.fr/1.jpg", "https://a.fr/2.jpg", "https://a.fr/3.jpg"])
  })

  it("flags the second occurrence of a supplier reference in the same file", () => {
    const { rows } = parseCatalogImportTable([header, line(valid), line({ ...valid, supplierSku: "ap 200" })])
    expect(rows.map((r) => r.status)).toEqual(["valid", "invalid"])
    expect(rows[1]?.errors.join(" ")).toMatch(/ligne 2/)
  })

  it("matches headers loosely and by their technical key", () => {
    const loose = CATALOG_IMPORT_COLUMNS.map((c) => c.key.toUpperCase())
    const { missingColumns, rows } = parseCatalogImportTable([loose, line(valid)])
    expect(missingColumns).toEqual([])
    expect(rows[0]?.status).toBe("valid")
  })

  it("lists the required columns that are missing", () => {
    const { missingColumns, rows } = parseCatalogImportTable([
      ["Nom", "Importer"],
      ["x", "oui"],
    ])
    expect(missingColumns).toEqual(expect.arrayContaining(["Fournisseur", "Réf. fournisseur", "Catégorie légale"]))
    expect(rows).toEqual([])
  })

  it("rejects a formula left in a cell rather than storing it as text", () => {
    const { rows } = parseCatalogImportTable([header, line({ ...valid, name: '=HYPERLINK("http://x")' })])
    expect(rows[0]?.status).toBe("invalid")
  })
})
