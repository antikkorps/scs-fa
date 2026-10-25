// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { computed, ref } from "vue"
import Documents from "./documents.vue"

const { documents, documentsBase } = vi.hoisted(() => ({
  documents: { list: vi.fn(), get: vi.fn(), upload: vi.fn(), remove: vi.fn(), orderLegal: vi.fn() },
  documentsBase: { value: "" },
}))
mockNuxtImport("useDocuments", () => (base: string) => {
  documentsBase.value = base
  return documents
})
mockNuxtImport("useProAccess", () => () => ({
  organisation: ref({ status: "approved" }),
  isApprovedPro: computed(() => true),
  load: vi.fn(),
}))

const doc = (overrides: Record<string, unknown> = {}) => ({
  id: "d1",
  docType: "agrement_armurier",
  docNumber: "AG-1",
  mimeType: "application/pdf",
  fileSize: 1000,
  scanStatus: "clean",
  scannedAt: null,
  verificationStatus: "approved",
  issuedAt: null,
  expiresAt: "2030-12-31",
  uploadedAt: "2026-10-25T10:00:00Z",
  ...overrides,
})

beforeEach(() => {
  for (const fn of Object.values(documents)) fn.mockReset()
  documents.list.mockResolvedValue([
    doc(),
    doc({ id: "d2", docType: "bon_de_commande", verificationStatus: "pending" }),
  ])
})

describe("pro/documents (story 12.8d)", () => {
  it("lists the organisation's documents with their status, from the pro endpoint", async () => {
    const wrapper = await mountSuspended(Documents, { route: "/pro/documents" })
    await flushPromises()

    expect(documentsBase.value).toBe("/pro/documents")
    const rows = wrapper.findAll(".doc")
    expect(rows).toHaveLength(2)
    expect(rows[0]?.text()).toContain("Agrément d'armurier")
    expect(rows[0]?.text()).toContain("Approuvé")
    expect(rows[1]?.text()).toContain("Bon de commande signé")
  })

  it("offers only the professional types to file", async () => {
    const wrapper = await mountSuspended(Documents, { route: "/pro/documents" })
    await flushPromises()

    const options = wrapper.findAll("select[name='docType'] option").map((option) => option.attributes("value"))
    expect(options).toEqual([
      "agrement_armurier",
      "autorisation_commerce",
      "affiliation_federale",
      "autorisation_prefectorale",
      "autorisation_cnaps",
      "bon_de_commande",
    ])
  })

  it("withdraws a document not yet validated, never a validated one", async () => {
    vi.stubGlobal("confirm", () => true)
    documents.remove.mockResolvedValue(undefined)
    const wrapper = await mountSuspended(Documents, { route: "/pro/documents" })
    await flushPromises()

    const rows = wrapper.findAll(".doc")
    expect(rows[0]?.find("button.remove").exists()).toBe(false)
    await rows[1]?.find("button.remove").trigger("click")
    await flushPromises()
    expect(documents.remove).toHaveBeenCalledWith("d2")
    vi.unstubAllGlobals()
  })
})
