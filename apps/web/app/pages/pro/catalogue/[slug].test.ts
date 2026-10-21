// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { computed, ref } from "vue"
import ProProduct from "./[slug].vue"

const { apiMock, addToBasket } = vi.hoisted(() => ({ apiMock: vi.fn(), addToBasket: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)
mockNuxtImport("useQuotes", () => () => ({ addToBasket }))
mockNuxtImport("useRoute", () => () => ({
  params: { slug: "gilet-niveau-3a" },
  fullPath: "/pro/catalogue/gilet-niveau-3a",
}))
mockNuxtImport("useProAccess", () => () => ({
  organisation: ref({ status: "approved" }),
  isApprovedPro: computed(() => true),
  load: vi.fn(),
}))

const PRODUCT = {
  id: "p1",
  sku: "VEST-1",
  slug: "gilet-niveau-3a",
  name: "Gilet niveau IIIA",
  description: "Protection balistique souple.",
  longDescription: null,
  featuredImageUrl: null,
  category: { slug: "accessoire-tireur", name: "Accessoires" },
  legalCategory: { category: "none", name: "Hors catégorie", requiresVerification: false },
  audience: "pro",
  stockQty: 4,
  netPriceHt: null,
  netPriceTtc: null,
  variants: [
    {
      id: "v-m",
      skuVariant: "VEST-1-M",
      finition: null,
      munition: null,
      couleur: "Taille M",
      stockQty: 2,
      netPriceHt: null,
      netPriceTtc: null,
    },
    {
      id: "v-l",
      skuVariant: "VEST-1-L",
      finition: null,
      munition: null,
      couleur: "Taille L",
      stockQty: 2,
      netPriceHt: null,
      netPriceTtc: null,
    },
  ],
}

beforeEach(() => {
  apiMock.mockReset().mockResolvedValue({ data: PRODUCT })
  addToBasket.mockReset().mockResolvedValue({ items: [] })
})

async function mountPage() {
  const wrapper = await mountSuspended(ProProduct, { route: "/pro/catalogue/gilet-niveau-3a" })
  await flushPromises()
  return wrapper
}

describe("pro/catalogue/[slug] (story 12.8c)", () => {
  it("shows the article and its variants, on quote", async () => {
    const wrapper = await mountPage()
    expect(apiMock).toHaveBeenCalledWith("/pro/products/slug/gilet-niveau-3a")
    expect(wrapper.find("h1").text()).toBe("Gilet niveau IIIA")
    expect(wrapper.text()).toContain("Taille L")
    expect(wrapper.text()).toContain("Prix sur devis")
  })

  it("adds the chosen variant and quantity to the request", async () => {
    const wrapper = await mountPage()
    await wrapper.findAll('input[name="variant"]')[1]?.setValue(true)
    await wrapper.find('input[name="qty"]').setValue("12")
    await wrapper.find("form.pro-add").trigger("submit")
    await flushPromises()

    expect(addToBasket).toHaveBeenCalledWith("v-l", 12)
    expect(wrapper.text()).toContain("Ajouté à votre demande")
    expect(wrapper.find('a[href="/pro/demande"]').exists()).toBe(true)
  })

  it("explains a line already at its cap", async () => {
    addToBasket.mockRejectedValue({ response: { status: 409 }, data: { error: "QuantityTooLarge" } })
    const wrapper = await mountPage()
    await wrapper.find("form.pro-add").trigger("submit")
    await flushPromises()
    expect(wrapper.text()).toMatch(/9\s999/)
  })

  it("says so when the article is not in the pro catalogue", async () => {
    apiMock.mockRejectedValue({ response: { status: 404 } })
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain("Article introuvable")
  })
})
