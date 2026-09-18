// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import type { ProductCrossSellItem } from "~/types/product"
import ProductCrossSell from "./ProductCrossSell.vue"

const item = (over: Partial<ProductCrossSellItem> = {}): ProductCrossSellItem => ({
  id: "a1",
  slug: "lunette-test",
  name: "Lunette Test",
  description: null,
  priceHt: 200,
  priceTtc: 240,
  featuredImageUrl: null,
  category: { slug: "aide-visee", name: "Aides à la visée" },
  ...over,
})

describe("ProductCrossSell", () => {
  it("lists each suggestion with its price and a link to its page", async () => {
    const wrapper = await mountSuspended(ProductCrossSell, {
      props: { items: [item()], weaponName: "Pistolet Test" },
    })
    expect(wrapper.text()).toContain("Fréquemment achetés ensemble")
    expect(wrapper.text()).toContain("Lunette Test")
    expect(wrapper.text()).toContain("240")
    expect(wrapper.find("a").attributes("href")).toBe("/boutique/lunette-test")
  })

  /**
   * ⚠️ Le bloc est éteint par défaut : l'API rend alors une liste vide, et la
   * fiche ne doit pas afficher un titre suivi de rien.
   */
  it("ne rend rien du tout quand il n'y a aucune suggestion", async () => {
    const wrapper = await mountSuspended(ProductCrossSell, { props: { items: [], weaponName: "Pistolet Test" } })
    expect(wrapper.find("section").exists()).toBe(false)
    expect(wrapper.text()).not.toContain("Fréquemment")
  })

  it("garde l'ordre voulu par l'admin", async () => {
    const wrapper = await mountSuspended(ProductCrossSell, {
      props: {
        items: [item({ id: "a1", name: "Gants" }), item({ id: "a2", name: "Lunette", slug: "lunette" })],
        weaponName: "Pistolet Test",
      },
    })
    const names = wrapper.findAll(".xsell__name").map((n) => n.text())
    expect(names).toEqual(["Gants", "Lunette"])
  })
})
