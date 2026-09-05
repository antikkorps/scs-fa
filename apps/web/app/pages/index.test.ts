// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import { ref } from "vue"
import IndexPage from "./index.vue"

const artwork = {
  id: "a1",
  slug: "eclat",
  title: "Éclat",
  artistName: "SCS",
  description: null,
  featuredImageUrl: null,
  orientation: "landscape",
  editionLimit: 25,
  editionYear: 2026,
  availableCount: 5,
  soldCount: 2,
  priceFromHt: 40000,
  priceFromTtc: 48000,
}

const product = {
  id: "p1",
  sku: "CAR-1",
  slug: "carabine-x",
  name: "Carabine X",
  description: null,
  priceHt: 100000,
  vatPct: 20,
  priceTtc: 120000,
  stockQty: 3,
  featured: true,
  requiresLegalVerification: true,
  featuredImageUrl: null,
  category: { slug: "carabines", name: "Carabines" },
  legalCategory: "C",
  createdAt: "2026-01-01T00:00:00.000Z",
}

// Branch on the fetched URL so both universes get their own payload.
mockNuxtImport("useFetch", () => (url: string) => {
  if (typeof url === "string" && url.includes("/artworks")) {
    return { data: ref({ data: [artwork] }) }
  }
  return {
    data: ref({ data: [product], pagination: { page: 1, limit: 3, total: 1, totalPages: 1, hasMore: false } }),
  }
})

describe("home (unified)", () => {
  it("presents both universes in the hero", async () => {
    const wrapper = await mountSuspended(IndexPage)
    const text = wrapper.text()
    expect(text).toContain("Armurerie de précision")
    expect(text).toContain("Gun Art")
  })

  it("links to both the boutique and the collection", async () => {
    const wrapper = await mountSuspended(IndexPage)
    expect(wrapper.find('a[href="/boutique"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/collection"]').exists()).toBe(true)
  })

  it("renders a selection from each universe", async () => {
    const wrapper = await mountSuspended(IndexPage)
    const text = wrapper.text()
    expect(text).toContain("Sélection de la boutique")
    expect(text).toContain("Carabine X") // armurerie product
    expect(text).toContain("Pièces du moment")
    expect(text).toContain("Éclat") // gun art piece
  })
})
