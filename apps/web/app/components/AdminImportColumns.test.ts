// @vitest-environment nuxt
import { CATALOG_IMPORT_COLUMNS } from "@armurier/shared"
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import AdminImportColumns from "./AdminImportColumns.vue"

// Story 12.16d: Fred did not know the file could carry the categories and the
// tags. The import page now lists every column it reads, and how.
describe("AdminImportColumns", () => {
  it("lists every column of the import, in the file's order", async () => {
    const wrapper = await mountSuspended(AdminImportColumns)
    const names = wrapper.findAll("tbody th").map((cell) => cell.text())
    expect(names).toEqual(CATALOG_IMPORT_COLUMNS.map((column) => column.header))
  })

  it("marks the required columns", async () => {
    const wrapper = await mountSuspended(AdminImportColumns)
    const required = wrapper
      .findAll("tbody tr")
      .filter((row) => row.text().includes("Obligatoire"))
      .map((row) => row.find("th").text())
    expect(required).toEqual(CATALOG_IMPORT_COLUMNS.filter((column) => column.required).map((column) => column.header))
  })

  it("says how to fill the categories and the tags", async () => {
    const wrapper = await mountSuspended(AdminImportColumns)
    const rowOf = (header: string) => wrapper.findAll("tbody tr").find((row) => row.find("th").text() === header)
    expect(rowOf("Catégorie")?.text()).toContain("Remplacer les infos")
    expect(rowOf("Tags")?.text()).toContain("séparés par des virgules")
    expect(rowOf("Sous-catégorie")?.text()).toContain("« Aucune » la retire")
  })

  it("stays folded until asked, to keep the page short", async () => {
    const wrapper = await mountSuspended(AdminImportColumns)
    expect(wrapper.find("details").attributes("open")).toBeUndefined()
    expect(wrapper.find("summary").text()).toBe("Colonnes du fichier et comment les remplir")
  })
})
