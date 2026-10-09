import { type CollectedProduct, parseCatalogImportTable } from "@armurier/shared"
import { readSpreadsheet } from "@armurier/shared/spreadsheet"
import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"
import {
  buildTriageModel,
  pricesFromCollection,
  type SupplierBatch,
  supplierConfigSchema,
  writeTriageWorkbook,
} from "./triage.js"

const categories = [
  { slug: "aide-visee", name: "Aides à la visée" },
  { slug: "arme-longue", name: "Armes longues" },
]

const product = (over: Partial<CollectedProduct>): CollectedProduct => ({
  supplier: "BGM Winfield",
  supplierSku: "AP-1",
  name: "Aimpoint Micro",
  brand: "Aimpoint",
  imageUrls: ["https://s.fr/1.jpg", "https://s.fr/2.jpg"],
  specs: { Grossissement: "1x", Poids: "84 g" },
  longDescription: "<p>Viseur <b>robuste</b></p>",
  sourceCategory: "Optoélectronique > Points rouges",
  sourceUrl: "https://s.fr/p/1",
  ...over,
})

const batch = (over: Partial<SupplierBatch> = {}): SupplierBatch => ({
  supplier: "BGM Winfield",
  products: [product({}), product({ supplierSku: "CARA-9", name: "Carabine", sourceCategory: "Armes > Carabines" })],
  prices: [
    { line: 3, ref: "ap 1", price: 70, ean: null },
    { line: 4, ref: "ORPHAN", price: 12, ean: "4006381333931" },
  ],
  config: supplierConfigSchema.parse({
    marginPct: 30,
    rules: [
      { match: "points rouges", category: "aide-visee", legalCategory: "none" },
      { match: "carabine", field: "name", category: "arme-longue" },
    ],
  }),
  ...over,
})

describe("buildTriageModel", () => {
  it("proposes price, category and — only from a rule — the legal category", () => {
    const model = buildTriageModel([batch()], categories)
    expect(model.stats).toEqual({ matched: 1, no_price: 1, ambiguous: 0 })
    const [redDot, rifle] = model.rows
    expect(redDot).toMatchObject({
      import: null,
      supplier: "BGM Winfield",
      supplierSku: "AP-1",
      costPriceHt: 70,
      priceHt: 100,
      category: "Aides à la visée",
      legalCategory: "Aucune",
      matchStatus: "Rapproché",
      imageUrls: "https://s.fr/1.jpg\nhttps://s.fr/2.jpg",
      description: "Viseur robuste",
    })
    expect(redDot?.longDescription).toContain("<li><strong>Poids</strong> : 84 g</li>")
    // A rule that sets no legal category leaves it blank: never guessed.
    expect(rifle).toMatchObject({
      category: "Armes longues",
      legalCategory: null,
      priceHt: null,
      matchStatus: "Sans prix",
    })
  })

  it("maps the supplier's legal classification only through a hand-written rule", () => {
    const humbert = (sku: string, supplierLegalClass: string | undefined) =>
      product({ supplier: "Humbert", supplierSku: sku, sourceCategory: "Carabines > Verrou", supplierLegalClass })
    const rules = [
      { match: "^carabines", category: "arme-longue" },
      { match: "^B", field: "supplierLegalClass", legalCategory: "B" },
      { match: "^C", field: "supplierLegalClass", legalCategory: "C" },
    ]
    const model = buildTriageModel(
      [
        batch({
          supplier: "Humbert",
          prices: null,
          products: [humbert("H-1", "C1a"), humbert("H-2", "B2e"), humbert("H-3", "NR"), humbert("H-4", undefined)],
          config: supplierConfigSchema.parse({ rules }),
        }),
      ],
      categories,
    )
    // The category rule and the classification rule both apply to the same article.
    expect(model.rows.map((r) => [r.supplierSku, r.category, r.legalCategory, r.supplierLegalClass])).toEqual([
      ["H-1", "Armes longues", "C", "C1a"],
      ["H-2", "Armes longues", "B", "B2e"],
      // No rule covers "NR", and an article without a classification gets none: left blank.
      ["H-3", "Armes longues", null, "NR"],
      ["H-4", "Armes longues", null, null],
    ])
  })

  it("keeps the first rule that sets each field", () => {
    const model = buildTriageModel(
      [
        batch({
          prices: null,
          products: [product({})],
          config: supplierConfigSchema.parse({
            rules: [
              { match: "points rouges", category: "aide-visee" },
              { match: "optoélectronique", category: "arme-longue", legalCategory: "none" },
            ],
          }),
        }),
      ],
      categories,
    )
    expect(model.rows[0]).toMatchObject({ category: "Aides à la visée", legalCategory: "Aucune" })
  })

  it("lists the price lines no product claimed", () => {
    expect(buildTriageModel([batch()], categories).orphans).toEqual([
      { supplier: "BGM Winfield", ref: "ORPHAN", ean: "4006381333931", price: 12, line: 4 },
    ])
  })

  it("treats a supplier without price list as all 'no price'", () => {
    const model = buildTriageModel([batch({ prices: null })], categories)
    expect(model.stats).toEqual({ matched: 0, no_price: 2, ambiguous: 0 })
  })

  it("reconciles purchase prices read from a pro area like a price list", () => {
    const products = [product({ purchasePrice: 70 }), product({ supplierSku: "CARA-9", name: "Carabine" })]
    const prices = pricesFromCollection(products)
    expect(prices).toEqual([{ line: 1, ref: "AP-1", price: 70, ean: null }])
    const model = buildTriageModel([batch({ products, prices })], categories)
    expect(model.stats).toEqual({ matched: 1, no_price: 1, ambiguous: 0 })
    expect(model.orphans).toEqual([])
  })

  it("falls back to plain text when the HTML would exceed the import limit", () => {
    // Ampersands and line breaks grow when escaped and wrapped: still within the limit.
    const long = product({ longDescription: `<p>${"a & b<br>".repeat(4000)}</p>`, specs: {} })
    const [row] = buildTriageModel([batch({ products: [long] })], categories).rows
    expect(String(row?.longDescription).length).toBeLessThanOrEqual(20000)
  })
})

describe("writeTriageWorkbook", () => {
  it("round-trips through the admin import: same columns, and a row a human completed is valid", async () => {
    const model = buildTriageModel([batch()], categories)
    const file = await writeTriageWorkbook(model, categories)

    const table = await readSpreadsheet(file)
    const parsed = parseCatalogImportTable(table)
    expect(parsed.missingColumns).toEqual([])
    // Untouched, nothing is imported: "Importer" is the human's column.
    expect(parsed.rows.every((r) => r.status === "skipped")).toBe(true)

    const header = table[0] ?? []
    const importCol = header.indexOf("Importer")
    const filled = table.map((row, i) => (i === 1 ? row.map((c, j) => (j === importCol ? "oui" : c)) : row))
    const [first] = parseCatalogImportTable(filled).rows
    expect(first?.status).toBe("valid")
    expect(first?.data).toMatchObject({
      supplierSku: "AP-1",
      priceHt: 100,
      legalCategory: "none",
      category: "Aides à la visée",
    })
  })

  it("adds drop-downs, the orphan prices sheet and instructions", async () => {
    const file = await writeTriageWorkbook(buildTriageModel([batch()], categories), categories)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(file as unknown as ArrayBuffer)
    expect(wb.worksheets.map((w) => w.name)).toEqual(["À trier", "Listes", "Prix sans fiche", "Lisez-moi"])
    const validations = Object.values(
      (wb.getWorksheet("À trier") as unknown as { dataValidations: { model: Record<string, { formulae: string[] }> } })
        .dataValidations.model,
    ).map((v) => v.formulae[0])
    expect(validations).toEqual(expect.arrayContaining(['"oui,non"', '"A,B,C,D,Aucune"', "Listes!$A$1:$A$2"]))
    expect(wb.getWorksheet("Prix sans fiche")?.getRow(2).getCell(2).value).toBe("ORPHAN")
  })

  it("warns that the supplier must exist in the back office before the import (story 12.5)", async () => {
    const file = await writeTriageWorkbook(buildTriageModel([batch()], categories), categories)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(file as unknown as ArrayBuffer)
    const readme = wb.getWorksheet("Lisez-moi")?.getColumn(1).values.join("\n")
    expect(readme).toMatch(/Catalogue → Fournisseurs/)
  })
})
