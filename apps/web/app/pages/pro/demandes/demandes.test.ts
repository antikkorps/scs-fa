// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { computed, ref } from "vue"
import Detail from "./[id].vue"
import List from "./index.vue"

const { quotes, routeQuery } = vi.hoisted(() => ({
  quotes: { listRequests: vi.fn(), getRequest: vi.fn(), cancelRequest: vi.fn() },
  routeQuery: { value: {} as Record<string, string> },
}))
mockNuxtImport("useQuotes", () => () => quotes)
mockNuxtImport("useRoute", () => () => ({
  params: { id: "r1" },
  query: routeQuery.value,
  fullPath: "/pro/demandes/r1",
}))
mockNuxtImport("useProAccess", () => () => ({
  organisation: ref({ status: "approved" }),
  isApprovedPro: computed(() => true),
  load: vi.fn(),
}))

const REQUEST = {
  id: "r1",
  number: "DR-2026-0001",
  status: "requested",
  message: "Livraison au poste",
  validUntil: null,
  createdAt: "2026-10-21T10:00:00Z",
  updatedAt: "2026-10-21T10:00:00Z",
  items: [
    {
      id: "i1",
      position: 1,
      productId: "p1",
      productSlug: "gilet",
      productName: "Gilet niveau IIIA",
      productSku: "VEST-1",
      variantSku: "VEST-1-M",
      variantLabel: "Taille M",
      legalCategory: "none",
      qty: 12,
    },
  ],
}

beforeEach(() => {
  for (const fn of Object.values(quotes)) fn.mockReset()
  routeQuery.value = {}
  quotes.listRequests.mockResolvedValue([{ ...REQUEST, lineCount: 1 }])
  quotes.getRequest.mockResolvedValue(REQUEST)
})

describe("pro/demandes (story 12.8c)", () => {
  it("lists the organisation's requests with their status", async () => {
    const wrapper = await mountSuspended(List, { route: "/pro/demandes" })
    await flushPromises()
    const row = wrapper.find(".request")
    expect(row.text()).toContain("DR-2026-0001")
    expect(row.text()).toContain("Envoyée")
    expect(row.text()).toContain("1 article")
    expect(row.find("a").attributes("href")).toBe("/pro/demandes/r1")
  })

  it("shows a request's lines and message, and confirms one just sent", async () => {
    routeQuery.value = { envoyee: "1" }
    const wrapper = await mountSuspended(Detail, { route: "/pro/demandes/r1" })
    await flushPromises()
    expect(wrapper.find("h1").text()).toContain("DR-2026-0001")
    expect(wrapper.text()).toContain("Demande envoyée")
    expect(wrapper.text()).toContain("Gilet niveau IIIA")
    expect(wrapper.text()).toContain("12")
    expect(wrapper.text()).toContain("Livraison au poste")
  })

  it("cancels a request SCS has not started on", async () => {
    quotes.cancelRequest.mockResolvedValue({ ...REQUEST, status: "cancelled" })
    vi.stubGlobal("confirm", () => true)
    const wrapper = await mountSuspended(Detail, { route: "/pro/demandes/r1" })
    await flushPromises()

    await wrapper.find("button.cancel").trigger("click")
    await flushPromises()
    expect(quotes.cancelRequest).toHaveBeenCalledWith("r1")
    expect(wrapper.text()).toContain("Annulée")
    expect(wrapper.find("button.cancel").exists()).toBe(false)
    vi.unstubAllGlobals()
  })

  it("offers no cancellation once SCS is on it", async () => {
    quotes.getRequest.mockResolvedValue({ ...REQUEST, status: "in_review" })
    const wrapper = await mountSuspended(Detail, { route: "/pro/demandes/r1" })
    await flushPromises()
    expect(wrapper.find("button.cancel").exists()).toBe(false)
  })
})
