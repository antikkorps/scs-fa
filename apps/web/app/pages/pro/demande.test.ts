// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { computed, ref } from "vue"
import Demande from "./demande.vue"

const { quotes, navigateToMock } = vi.hoisted(() => ({
  quotes: { fetchBasket: vi.fn(), updateLine: vi.fn(), removeLine: vi.fn(), submit: vi.fn() },
  navigateToMock: vi.fn(),
}))
mockNuxtImport("useQuotes", () => () => quotes)
mockNuxtImport("navigateTo", () => navigateToMock)
mockNuxtImport("useProAccess", () => () => ({
  organisation: ref({ status: "approved" }),
  isApprovedPro: computed(() => true),
  load: vi.fn(),
}))

const line = (overrides: Record<string, unknown> = {}) => ({
  id: "l1",
  qty: 3,
  available: true,
  netPriceHt: null,
  netPriceTtc: null,
  variant: { id: "v1", skuVariant: "VEST-1-M", label: "Taille M" },
  product: {
    id: "p1",
    slug: "gilet",
    name: "Gilet niveau IIIA",
    sku: "VEST-1",
    featuredImageUrl: null,
    legalCategory: "none",
  },
  ...overrides,
})

beforeEach(() => {
  for (const fn of Object.values(quotes)) fn.mockReset()
  navigateToMock.mockReset()
  quotes.fetchBasket.mockResolvedValue({ items: [line()] })
})

async function mountPage() {
  const wrapper = await mountSuspended(Demande, { route: "/pro/demande" })
  await flushPromises()
  return wrapper
}

describe("pro/demande (story 12.8c)", () => {
  it("lists the lines being prepared, with no price", async () => {
    const wrapper = await mountPage()
    const text = wrapper.find(".quote-line").text()
    expect(text).toContain("Gilet niveau IIIA")
    expect(text).toContain("Taille M")
    expect(text).not.toContain("€")
  })

  it("changes a quantity and removes a line", async () => {
    quotes.updateLine.mockResolvedValue({ items: [line({ qty: 8 })] })
    quotes.removeLine.mockResolvedValue({ items: [] })
    const wrapper = await mountPage()

    await wrapper.find('input[name="qty-l1"]').setValue("8")
    await wrapper.find('input[name="qty-l1"]').trigger("change")
    await flushPromises()
    expect(quotes.updateLine).toHaveBeenCalledWith("l1", 8)

    await wrapper.find("button.quote-line__remove").trigger("click")
    await flushPromises()
    expect(quotes.removeLine).toHaveBeenCalledWith("l1")
    expect(wrapper.text()).toContain("Votre demande est vide")
  })

  it("sends the request with its message and opens it", async () => {
    quotes.submit.mockResolvedValue({ id: "r1", number: "DR-2026-0001" })
    const wrapper = await mountPage()
    await wrapper.find("textarea").setValue("Livraison au poste de police")
    await wrapper.find("form.quote-send").trigger("submit")
    await flushPromises()

    expect(quotes.submit).toHaveBeenCalledWith("Livraison au poste de police")
    expect(navigateToMock).toHaveBeenCalledWith("/pro/demandes/r1?envoyee=1")
  })

  it("flags a line gone offline and names it when the request is refused", async () => {
    quotes.fetchBasket.mockResolvedValue({ items: [line({ available: false })] })
    quotes.submit.mockRejectedValue({
      response: { status: 409 },
      data: { error: "UnavailableItems", items: ["Gilet niveau IIIA"] },
    })
    const wrapper = await mountPage()
    expect(wrapper.find(".quote-line").text()).toContain("n'est plus proposé")

    await wrapper.find("form.quote-send").trigger("submit")
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain("Gilet niveau IIIA")
  })
})
