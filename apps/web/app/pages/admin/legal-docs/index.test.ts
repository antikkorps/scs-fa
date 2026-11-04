// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { clearNuxtData } from "#imports"
import type { LegalDocDetail, LegalDocQueueItem } from "~/types/admin"
import LegalDocs from "./index.vue"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

const QUEUED: LegalDocQueueItem = {
  id: "doc-1",
  docType: "permis_chasse",
  docNumber: null,
  scanStatus: "clean",
  verificationStatus: "pending",
  verificationDeadline: "2026-11-05T10:00:00Z",
  rejectionReason: null,
  uploadedAt: "2026-11-04T10:00:00Z",
  overdue: false,
  user: { id: "u1", email: "jean@example.fr", firstname: "Jean", lastname: "Martin" },
  organisation: null,
}

const DETAIL: LegalDocDetail = {
  ...QUEUED,
  mimeType: "image/jpeg",
  fileSize: 120_000,
  issuedAt: null,
  expiresAt: null,
  verificationNotes: null,
  downloadUrl: "https://storage.example/permis.jpg?signature=abc",
  orders: [
    {
      id: "0b7d1f3e-8a51-4c1e-9d0a-2f6b1c3e4d5f",
      reference: "0B7D1F3E",
      createdAt: "2026-11-03T09:00:00Z",
      legalVerificationStatus: "docs_verifying",
      paymentStatus: "pending",
      items: [{ name: "Carabine Browning X-Bolt", legalCategory: "C" }],
    },
  ],
}

function respond(detail: LegalDocDetail, queued: LegalDocQueueItem = QUEUED) {
  apiMock.mockImplementation(async (url: string) =>
    url.startsWith("/admin/legal-documents?")
      ? { data: [queued], pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasMore: false } }
      : { data: detail },
  )
}

async function openDrawer() {
  const wrapper = await mountSuspended(LegalDocs, { route: "/admin/legal-docs" })
  await flushPromises()
  await wrapper.find("tbody tr").trigger("click")
  await flushPromises()
  return wrapper
}

const plainText = (text: string) => text.replace(/\s+/g, " ")

beforeEach(() => {
  clearNuxtData()
  apiMock.mockReset()
  respond(DETAIL)
})

describe("admin/legal-docs — the verification drawer (audit 2026-11-01, I9)", () => {
  it("names the antivirus result instead of showing its code", async () => {
    const wrapper = await mountSuspended(LegalDocs, { route: "/admin/legal-docs" })
    await flushPromises()
    const row = plainText(wrapper.find("tbody tr").text())
    expect(row).toContain("Sain")
    expect(row).not.toContain("clean")
  })

  it("shows a photo of the document right in the drawer", async () => {
    const wrapper = await openDrawer()
    const preview = wrapper.find(".drawer img.preview")
    expect(preview.attributes("src")).toBe(DETAIL.downloadUrl)
    expect(preview.attributes("alt")).toContain("Permis de chasse")
    expect(wrapper.find(".drawer a.dl").attributes("href")).toBe(DETAIL.downloadUrl)
  })

  it("opens a PDF in a new tab, without a preview", async () => {
    respond({ ...DETAIL, mimeType: "application/pdf" })
    const wrapper = await openDrawer()
    expect(wrapper.find(".drawer img.preview").exists()).toBe(false)
    expect(wrapper.find(".drawer a.dl").attributes("href")).toBe(DETAIL.downloadUrl)
  })

  it("offers no file until the antivirus has passed it, and says why", async () => {
    respond({ ...DETAIL, scanStatus: "pending", downloadUrl: null }, { ...QUEUED, scanStatus: "pending" })
    const wrapper = await openDrawer()
    expect(wrapper.find(".drawer img.preview").exists()).toBe(false)
    expect(wrapper.find(".drawer a.dl").exists()).toBe(false)
    expect(plainText(wrapper.find(".drawer").text())).toContain("Fichier consultable après l'analyse antivirus")
    expect(plainText(wrapper.find(".drawer").text())).toContain("Analyse en cours")
  })

  it("lists the orders waiting for this document, with the weapon concerned", async () => {
    const wrapper = await openDrawer()
    const order = wrapper.find(".drawer .waiting-order")
    expect(order.find("a").attributes("href")).toBe("/admin/orders/0b7d1f3e-8a51-4c1e-9d0a-2f6b1c3e4d5f")
    const text = plainText(order.text())
    expect(text).toContain("0B7D1F3E")
    expect(text).toContain("Carabine Browning X-Bolt")
    expect(text).toContain("Catégorie C")
  })

  it("says when no order is waiting for the document", async () => {
    respond({ ...DETAIL, orders: [] })
    const wrapper = await openDrawer()
    expect(plainText(wrapper.find(".drawer").text())).toContain("Aucune commande en cours n'attend cette pièce")
  })

  it("explains that an organisation's document serves its quotes", async () => {
    const organisationDoc = { user: null, organisation: { id: "o1", legalName: "Armurerie du Lac" } }
    respond({ ...DETAIL, ...organisationDoc, orders: [] }, { ...QUEUED, ...organisationDoc })
    const wrapper = await openDrawer()
    const text = plainText(wrapper.find(".drawer").text())
    expect(text).toContain("Pièce d'un compte pro : elle sert à accepter ses devis")
    expect(text).not.toContain("Aucune commande en cours")
  })
})
