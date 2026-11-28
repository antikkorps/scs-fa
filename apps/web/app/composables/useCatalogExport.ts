import { slugify } from "@armurier/shared"
import type { CatalogExportSupplier } from "~/types/admin"
import { apiErrorMessage } from "~/utils/catalogImport"

/** Story 12.16d: CSV for those who work in CSV; the workbook keeps its drop-downs. */
export type CatalogExportFormat = "xlsx" | "csv"

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * The catalogue in the import's columns (story 12.4), whole or one supplier's
 * part: edit it, then bring it back through the import.
 */
export async function useCatalogExport() {
  const api = useApi()
  const supplier = ref("")
  const format = ref<CatalogExportFormat>("xlsx")
  const exporting = ref(false)
  const error = ref("")
  const { data } = await useAsyncData(
    "admin-catalog-export-suppliers",
    () => api<{ data: CatalogExportSupplier[] }>("/admin/catalog-imports/suppliers"),
    { server: false },
  )
  const suppliers = computed(() => data.value?.data ?? [])

  async function run() {
    exporting.value = true
    error.value = ""
    try {
      const chosen = suppliers.value.find((candidate) => candidate.id === supplier.value)
      const blob = await api<Blob>("/admin/catalog-imports/export", {
        responseType: "blob",
        query: chosen ? { supplierId: chosen.id, format: format.value } : { format: format.value },
      })
      const label = chosen ? `${slugify(chosen.name, 40)}-` : ""
      download(blob, `catalogue-${label}${new Date().toISOString().slice(0, 10)}.${format.value}`)
    } catch (err) {
      error.value = apiErrorMessage(err, "Export impossible.")
    } finally {
      exporting.value = false
    }
  }

  return { supplier, format, suppliers, exporting, error, run }
}
