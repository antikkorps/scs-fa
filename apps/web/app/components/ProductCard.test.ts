// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import type { ProductCardItem } from "~/types/product"
import ProductCard from "./ProductCard.vue"

const base: ProductCardItem = {
  slug: "pistolet-test",
  name: "Pistolet Test",
  priceTtc: 960,
  stockQty: 5,
  requiresLegalVerification: true,
  featuredImageUrl: null,
  category: { name: "Armes de poing" },
  legalCategory: "B",
}

describe("ProductCard", () => {
  it("renders name, legal badge, price and links to the detail page", async () => {
    const wrapper = await mountSuspended(ProductCard, { props: { product: base } })
    expect(wrapper.text()).toContain("Pistolet Test")
    expect(wrapper.text()).toContain("Catégorie B")
    expect(wrapper.text()).toContain("Contrôle légal requis")
    expect(wrapper.find("a").attributes("href")).toBe("/boutique/pistolet-test")
  })

  it("shows a free-sale badge and no rupture flag when in stock & unregulated", async () => {
    const wrapper = await mountSuspended(ProductCard, {
      props: { product: { ...base, legalCategory: "none", requiresLegalVerification: false } },
    })
    expect(wrapper.text()).toContain("Vente libre")
    expect(wrapper.text()).not.toContain("Rupture")
    expect(wrapper.text()).not.toContain("Contrôle légal requis")
  })

  it("flags a rupture when out of stock", async () => {
    const wrapper = await mountSuspended(ProductCard, { props: { product: { ...base, stockQty: 0 } } })
    expect(wrapper.text()).toContain("Rupture")
  })
})

describe("ProductCard availability (story 11.3)", () => {
  it("says « Rupture » for an ordinary product with no stock", async () => {
    const wrapper = await mountSuspended(ProductCard, {
      props: { product: { ...base, stockQty: 0 } },
    })
    expect(wrapper.text()).toContain("Rupture")
    expect(wrapper.text()).not.toContain("Vendu")
  })

  it("says « Vendu » for a unique piece, never promising a restock", async () => {
    const wrapper = await mountSuspended(ProductCard, {
      props: { product: { ...base, stockQty: 0, isUnique: true } },
    })
    expect(wrapper.text()).toContain("Vendu")
    expect(wrapper.text()).not.toContain("Rupture")
  })

  it("shows no availability badge while the item is in stock", async () => {
    const wrapper = await mountSuspended(ProductCard, {
      props: { product: { ...base, stockQty: 3, isUnique: true } },
    })
    expect(wrapper.find(".card__badge--stock").exists()).toBe(false)
  })

  it("keeps a sold piece linked rather than hiding it", async () => {
    // It stays online for its editorial and SEO value — no 404, no removal.
    const wrapper = await mountSuspended(ProductCard, {
      props: { product: { ...base, stockQty: 0, isUnique: true } },
    })
    expect(wrapper.find("a").attributes("href")).toBe("/boutique/pistolet-test")
  })
})
