// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import type { TagFacetGroup } from "~/types/product"
import ProductTagFilters from "./ProductTagFilters.vue"

const facets: TagFacetGroup[] = [
  {
    facet: "etat",
    tags: [
      { slug: "occasion", name: "Occasion", facet: "etat", description: null, productCount: 4 },
      { slug: "neuf", name: "Neuf", facet: "etat", description: null, productCount: 9 },
    ],
  },
  {
    facet: "epoque",
    tags: [{ slug: "avant-1900", name: "Avant 1900", facet: "epoque", description: null, productCount: 2 }],
  },
]

describe("ProductTagFilters", () => {
  it("renders each facet under its French label, with product counts", async () => {
    const wrapper = await mountSuspended(ProductTagFilters, { props: { facets, selected: [] } })
    expect(wrapper.text()).toContain("État")
    expect(wrapper.text()).toContain("Époque")
    expect(wrapper.text()).toContain("Occasion")
    expect(wrapper.text()).toContain("4")
  })

  it("checks the boxes matching the current selection", async () => {
    const wrapper = await mountSuspended(ProductTagFilters, { props: { facets, selected: ["occasion"] } })
    const boxes = wrapper.findAll("input[type=checkbox]")
    expect((boxes[0]?.element as HTMLInputElement).checked).toBe(true)
    expect((boxes[1]?.element as HTMLInputElement).checked).toBe(false)
  })

  it("emits toggle with the tag slug when a box is ticked", async () => {
    const wrapper = await mountSuspended(ProductTagFilters, { props: { facets, selected: [] } })
    await wrapper.findAll("input[type=checkbox]")[1]?.setValue(true)
    expect(wrapper.emitted("toggle")?.[0]).toEqual(["neuf"])
  })

  it("offers a clear action only when something is selected", async () => {
    const empty = await mountSuspended(ProductTagFilters, { props: { facets, selected: [] } })
    expect(empty.text()).not.toContain("Tout effacer")

    const filtered = await mountSuspended(ProductTagFilters, { props: { facets, selected: ["occasion"] } })
    expect(filtered.text()).toContain("Tout effacer")
    await filtered.find(".tagf__clear").trigger("click")
    expect(filtered.emitted("clear")).toHaveLength(1)
  })

  it("renders nothing when no facet carries a tag", async () => {
    const wrapper = await mountSuspended(ProductTagFilters, { props: { facets: [], selected: [] } })
    expect(wrapper.find(".tagf").exists()).toBe(false)
  })
})
