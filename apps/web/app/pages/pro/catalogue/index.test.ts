// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { computed, ref } from "vue"
import ProCatalogue from "./index.vue"

const { apiMock, organisation } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  organisation: {
    value: { status: "approved", legalName: "Armurerie Armand", reviewReason: null } as Record<string, unknown> | null,
  },
}))
mockNuxtImport("useApi", () => () => apiMock)
mockNuxtImport("useProAccess", () => () => ({
  organisation: ref(organisation.value),
  isApprovedPro: computed(() => organisation.value?.status === "approved"),
  load: vi.fn(),
}))

const CARD = {
  id: "p1",
  sku: "VEST-1",
  slug: "gilet-niveau-3a",
  name: "Gilet niveau IIIA",
  description: null,
  featuredImageUrl: null,
  category: { slug: "accessoire-tireur", name: "Accessoires" },
  legalCategory: "none",
  audience: "pro",
  stockQty: 4,
  netPriceHt: null,
  netPriceTtc: null,
}
const PAGE = { page: 1, limit: 24, total: 1, totalPages: 1, hasMore: false }

beforeEach(() => {
  organisation.value = { status: "approved", legalName: "Armurerie Armand", reviewReason: null }
  apiMock.mockReset()
  apiMock.mockImplementation(async (url: string | undefined) => {
    if (url?.startsWith("/pro/products")) return { data: [CARD], pagination: PAGE }
    if (url === "/product-categories")
      return { data: [{ slug: "accessoire-tireur", name: "Accessoires", category: "accessoire_tireur" }] }
    return { data: [] }
  })
})

async function mountPage() {
  const wrapper = await mountSuspended(ProCatalogue, { route: "/pro/catalogue" })
  await flushPromises()
  return wrapper
}

describe("pro/catalogue (story 12.8c)", () => {
  it("lists the pro catalogue, marking what is reserved for pros, with no price", async () => {
    const wrapper = await mountPage()
    expect(apiMock).toHaveBeenCalledWith("/pro/products", { query: { page: 1, limit: 24 } })
    const card = wrapper.find(".pro-card")
    expect(card.text()).toContain("Gilet niveau IIIA")
    expect(card.text()).toContain("Réservé pro")
    expect(card.text()).toContain("Prix sur devis")
    expect(card.find("a").attributes("href")).toBe("/pro/catalogue/gilet-niveau-3a")
  })

  it("shows the net price when SCS opened prices to this pro", async () => {
    apiMock.mockImplementation(async (url: string | undefined) =>
      url?.startsWith("/pro/products")
        ? { data: [{ ...CARD, netPriceHt: 360, netPriceTtc: 432 }], pagination: PAGE }
        : { data: [] },
    )
    const wrapper = await mountPage()
    expect(wrapper.find(".pro-card").text()).toMatch(/360,00\s?€ HT/)
  })

  it("searches and filters by category", async () => {
    const wrapper = await mountPage()
    await wrapper.find('input[type="search"]').setValue("gilet")
    await wrapper.find("form.pro-filters").trigger("submit")
    await flushPromises()
    expect(apiMock).toHaveBeenLastCalledWith("/pro/products", { query: { page: 1, limit: 24, search: "gilet" } })

    await wrapper.find("select").setValue("accessoire-tireur")
    await flushPromises()
    expect(apiMock).toHaveBeenLastCalledWith("/pro/products", {
      query: { page: 1, limit: 24, search: "gilet", category: "accessoire-tireur" },
    })
  })

  it("explains, without loading anything, why a pending pro cannot see it yet", async () => {
    organisation.value = { status: "pending", legalName: "Armurerie Armand", reviewReason: null }
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain("Demande en cours d'examen")
    expect(apiMock).not.toHaveBeenCalledWith("/pro/products", expect.anything())
  })
})
