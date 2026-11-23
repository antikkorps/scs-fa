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

  it("speaks plainly: a short title, no jargon, no explanation of how boxes combine", async () => {
    const wrapper = await mountSuspended(ProductTagFilters, { props: { facets, selected: [] } })
    expect(wrapper.find(".tagf__title").text()).toBe("Affiner")
    expect(wrapper.text()).not.toMatch(/tag/i)
    expect(wrapper.find(".tagf__hint").exists()).toBe(false)
    expect(wrapper.findAll(".tagf__count").map((count) => count.text())).toEqual(["(4)", "(9)", "(2)"])
  })

  it("checks the boxes matching the current selection", async () => {
    const wrapper = await mountSuspended(ProductTagFilters, { props: { facets, selected: ["occasion"] } })
    const boxes = wrapper.findAll("input[type=checkbox]")
    expect((boxes[0]?.element as HTMLInputElement | undefined)?.checked).toBe(true)
    expect((boxes[1]?.element as HTMLInputElement | undefined)?.checked).toBe(false)
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

  // Story 12.15e (Fred): a long, single-choice list — the calibre — reads as a
  // drop-down, not a cloud of pills.
  describe("the calibre", () => {
    const withCalibre: TagFacetGroup[] = [
      ...facets,
      {
        facet: "calibre",
        tags: [
          { slug: "calibre-12", name: "12", facet: "calibre", description: null, productCount: 5 },
          { slug: "calibre-308", name: ".308 Win", facet: "calibre", description: null, productCount: 3 },
        ],
      },
    ]

    it("is a labelled drop-down, any calibre first, with the counts", async () => {
      const wrapper = await mountSuspended(ProductTagFilters, { props: { facets: withCalibre, selected: [] } })
      const select = wrapper.find("select.tagf__select")
      expect(wrapper.find(`label[for="${select.attributes("id")}"]`).text()).toBe("Calibre")
      expect(select.findAll("option").map((option) => option.text())).toEqual([
        "Tous calibres",
        "12 (5)",
        ".308 Win (3)",
      ])
      expect(wrapper.findAll("input[type=checkbox]")).toHaveLength(3)
    })

    it("shows the calibre chosen", async () => {
      const wrapper = await mountSuspended(ProductTagFilters, {
        props: { facets: withCalibre, selected: ["calibre-308"] },
      })
      expect((wrapper.find("select.tagf__select").element as HTMLSelectElement).value).toBe("calibre-308")
    })

    it("emits pick with the facet and the calibre, or none for any calibre", async () => {
      const wrapper = await mountSuspended(ProductTagFilters, {
        props: { facets: withCalibre, selected: ["calibre-12"] },
      })
      const select = wrapper.find("select.tagf__select")
      await select.setValue("calibre-308")
      await select.setValue("")
      expect(wrapper.emitted("pick")).toEqual([
        ["calibre", "calibre-308"],
        ["calibre", ""],
      ])
    })
  })

  it("renders nothing when no facet carries a tag", async () => {
    const wrapper = await mountSuspended(ProductTagFilters, { props: { facets: [], selected: [] } })
    expect(wrapper.find(".tagf").exists()).toBe(false)
  })
})
