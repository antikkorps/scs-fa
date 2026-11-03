// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ref, toValue } from "vue"
import ShopCatalogue from "./ShopCatalogue.vue"

const { productQueries } = vi.hoisted(() => ({ productQueries: [] as unknown[] }))

mockNuxtImport("useFetch", () => (url: string, opts?: { query?: unknown }) => {
  if (typeof url === "string" && url.includes("/product-categories")) {
    return {
      data: ref({
        data: [
          { slug: "arme-poing", name: "Armes de poing", category: "arme_poing", displayOrder: 1, description: null },
          { slug: "munition", name: "Munitions", category: "munition", displayOrder: 2, description: null },
        ],
      }),
    }
  }
  if (typeof url === "string" && url.includes("/tags")) {
    return {
      data: ref({
        data: [
          {
            facet: "etat",
            tags: [{ slug: "occasion", name: "Occasion", facet: "etat", description: null, productCount: 3 }],
          },
        ],
      }),
    }
  }
  productQueries.push(toValue(opts?.query))
  return {
    data: ref({ data: [], pagination: { page: 1, limit: 24, total: 0, totalPages: 0, hasMore: false } }),
    error: ref(null),
    pending: ref(false),
  }
})

describe("ShopCatalogue (story 9.6)", () => {
  // Spy on the real router — replacing useRouter wholesale breaks Nuxt's own
  // plugins — and only once mounted, since mounting navigates to `route`.
  const spyPush = () => vi.spyOn(useRouter(), "push").mockResolvedValue(undefined)

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("shows the page's own category as the selected one", async () => {
    const wrapper = await mountSuspended(ShopCatalogue, {
      props: { category: "arme-poing", basePath: "/boutique/categorie/arme-poing", listName: "x" },
      route: "/boutique/categorie/arme-poing",
    })
    const selected = wrapper.findAll("#shop-category option").filter((o) => (o.element as HTMLOptionElement).selected)
    expect(selected.map((o) => o.text())).toEqual(["Armes de poing"])
  })

  it("moves to the category's own page on change, keeping the other filters", async () => {
    const wrapper = await mountSuspended(ShopCatalogue, {
      props: { category: "", basePath: "/boutique", listName: "x" },
      route: "/boutique?legalCategory=B&page=3",
    })
    const push = spyPush()
    await wrapper.find("#shop-category").setValue("munition")
    expect(push).toHaveBeenCalledWith({ path: "/boutique/categorie/munition", query: { legalCategory: "B" } })
  })

  it("goes back to the whole catalogue when 'all categories' is chosen", async () => {
    const wrapper = await mountSuspended(ShopCatalogue, {
      props: { category: "munition", basePath: "/boutique/categorie/munition", listName: "x" },
      route: "/boutique/categorie/munition",
    })
    const push = spyPush()
    await wrapper.find("#shop-category").setValue("")
    expect(push).toHaveBeenCalledWith({ path: "/boutique", query: {} })
  })

  describe("on a tag page", () => {
    const tagPage = { category: "", tag: "occasion", basePath: "/boutique/tag/occasion", listName: "x" }

    it("lists the products carrying the page's tag", async () => {
      productQueries.length = 0
      await mountSuspended(ShopCatalogue, { props: tagPage, route: "/boutique/tag/occasion" })
      expect(productQueries.at(-1)).toMatchObject({ tags: "occasion" })
    })

    it("shows the page's tag as ticked, and unticking it goes back to the whole catalogue", async () => {
      const wrapper = await mountSuspended(ShopCatalogue, {
        props: tagPage,
        route: "/boutique/tag/occasion?legalCategory=B",
      })
      const box = wrapper.find(".tagf__box")
      expect((box.element as HTMLInputElement).checked).toBe(true)
      const push = spyPush()
      await box.trigger("change")
      expect(push).toHaveBeenCalledWith({ path: "/boutique", query: { legalCategory: "B" } })
    })

    it("keeps the tag when moving to a category", async () => {
      const wrapper = await mountSuspended(ShopCatalogue, { props: tagPage, route: "/boutique/tag/occasion" })
      const push = spyPush()
      await wrapper.find("#shop-category").setValue("munition")
      expect(push).toHaveBeenCalledWith({ path: "/boutique/categorie/munition", query: { tags: "occasion" } })
    })
  })

  // UX audit 2026-11-01 (I6): ~900 px of filters before the first product on a
  // phone, and no way to sort.
  describe("sorting", () => {
    it("offers the sorts, relevance first", async () => {
      const wrapper = await mountSuspended(ShopCatalogue, {
        props: { category: "", basePath: "/boutique", listName: "x" },
        route: "/boutique",
      })
      const options = wrapper.findAll("#shop-sort option")
      expect(options.map((o) => o.text())).toEqual(["Pertinence", "Prix croissant", "Prix décroissant", "Nouveautés"])
      expect(wrapper.find("label[for='shop-sort']").text()).toBe("Trier par")
    })

    it("sorts from the first page, keeping the filters", async () => {
      const wrapper = await mountSuspended(ShopCatalogue, {
        props: { category: "", basePath: "/boutique", listName: "x" },
        route: "/boutique?legalCategory=B&page=3",
      })
      const push = spyPush()
      await wrapper.find("#shop-sort").setValue("price_asc")
      expect(push).toHaveBeenCalledWith({ query: { legalCategory: "B", sort: "price_asc" } })
    })

    it("asks the API for the sort in the address, and keeps it when filtering", async () => {
      productQueries.length = 0
      const wrapper = await mountSuspended(ShopCatalogue, {
        props: { category: "", basePath: "/boutique", listName: "x" },
        route: "/boutique?sort=price_desc",
      })
      expect(productQueries.at(-1)).toMatchObject({ sort: "price_desc" })
      const push = spyPush()
      await wrapper.find("#shop-legal").setValue("C")
      expect(push).toHaveBeenCalledWith({ query: { legalCategory: "C", sort: "price_desc" } })
    })

    it("leaves an unknown sort out of the API request", async () => {
      productQueries.length = 0
      await mountSuspended(ShopCatalogue, {
        props: { category: "", basePath: "/boutique", listName: "x" },
        route: "/boutique?sort=bogus",
      })
      expect(productQueries.at(-1)).not.toHaveProperty("sort")
    })
  })

  describe("filters panel on a phone", () => {
    it("is folded behind a button that says how many filters are on", async () => {
      const wrapper = await mountSuspended(ShopCatalogue, {
        props: { category: "", basePath: "/boutique", listName: "x" },
        route: "/boutique?legalCategory=B&tags=occasion",
      })
      const toggle = wrapper.find("button.filters__toggle")
      expect(toggle.text()).toBe("Filtres (2)")
      expect(toggle.attributes("aria-expanded")).toBe("false")
      const panel = wrapper.find(`#${toggle.attributes("aria-controls")}`)
      expect(panel.classes()).not.toContain("is-open")

      await toggle.trigger("click")
      expect(toggle.attributes("aria-expanded")).toBe("true")
      expect(panel.classes()).toContain("is-open")
    })

    it("holds the category, legal category, price and tag filters, not the search", async () => {
      const wrapper = await mountSuspended(ShopCatalogue, {
        props: { category: "", basePath: "/boutique", listName: "x" },
        route: "/boutique",
      })
      const panel = wrapper.find("#shop-filters")
      expect(wrapper.find("button.filters__toggle").text()).toBe("Filtres")
      for (const selector of ["#shop-category", "#shop-legal", "#shop-min", "#shop-max", ".tagf"]) {
        expect(panel.find(selector).exists()).toBe(true)
      }
      expect(panel.find("#shop-search").exists()).toBe(false)
    })
  })
})
