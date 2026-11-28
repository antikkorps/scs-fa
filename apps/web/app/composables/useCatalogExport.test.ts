// @vitest-environment nuxt
import { mockNuxtImport } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useCatalogExport } from "./useCatalogExport"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

const SUPPLIERS = { data: [{ id: "s1", name: "BGM Winfield", products: 1880 }] }
let downloaded: string[] = []

beforeEach(() => {
  downloaded = []
  apiMock.mockReset()
  apiMock.mockImplementation((url: string) => Promise.resolve(url.endsWith("/suppliers") ? SUPPLIERS : new Blob(["x"])))
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:catalogue")
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloaded.push(this.download)
  })
})

afterEach(() => vi.restoreAllMocks())

// Story 12.16d: they work in CSV; the export offers it beside the workbook.
describe("useCatalogExport", () => {
  it("downloads one supplier's catalogue as CSV when asked", async () => {
    const exporter = await useCatalogExport()
    await flushPromises()
    exporter.supplier.value = "s1"
    exporter.format.value = "csv"
    await exporter.run()
    expect(apiMock).toHaveBeenCalledWith("/admin/catalog-imports/export", {
      responseType: "blob",
      query: { supplierId: "s1", format: "csv" },
    })
    expect(downloaded[0]).toMatch(/^catalogue-bgm-winfield-\d{4}-\d\d-\d\d\.csv$/)
  })

  it("keeps the workbook as the default", async () => {
    const exporter = await useCatalogExport()
    await exporter.run()
    expect(apiMock).toHaveBeenCalledWith("/admin/catalog-imports/export", {
      responseType: "blob",
      query: { format: "xlsx" },
    })
    expect(downloaded[0]).toMatch(/^catalogue-\d{4}-\d\d-\d\d\.xlsx$/)
  })

  it("says why the export failed", async () => {
    apiMock.mockImplementation((url: string) =>
      url.endsWith("/suppliers") ? Promise.resolve(SUPPLIERS) : Promise.reject({ data: { message: "Trop gros" } }),
    )
    const exporter = await useCatalogExport()
    await exporter.run()
    expect(exporter.error.value).toBe("Trop gros")
    expect(exporter.exporting.value).toBe(false)
  })
})
