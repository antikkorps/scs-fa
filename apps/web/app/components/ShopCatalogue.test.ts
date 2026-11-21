// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import type { DOMWrapper } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ref, toValue } from "vue"
import ShopCatalogue from "./ShopCatalogue.vue"

const { productQueries, pageAnswer } = vi.hoisted(() => ({
  productQueries: [] as unknown[],
  pageAnswer: {
    value: { page: 1, limit: 24, total: 0, totalPages: 0, hasMore: false },
    products: [] as unknown[],
  },
}))

mockNuxtImport("useFetch", () => (url: string, opts?: { query?: unknown }) => {
  if (typeof url === "string" && url.endsWith("/menu")) return { data: ref({ data: [] }), error: ref(null) }
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
    data: ref({ data: pageAnswer.products, pagination: pageAnswer.value }),
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
    pageAnswer.value = { page: 1, limit: 24, total: 0, totalPages: 0, hasMore: false }
  })

  // SEO audit 2026-11-15, finding 2: the categories were only in a <select>
  // and a hover menu, so the server-rendered page linked to none of them.
  const categoryHref = (wrapper: { findAll: (selector: string) => DOMWrapper<Element>[] }, name: string) =>
    wrapper
      .findAll(".catlinks a")
      .find((link) => link.text() === name)
      ?.attributes("href")

  it("links every category as a plain link, and marks the page's own", async () => {
    const wrapper = await mountSuspended(ShopCatalogue, {
      props: { category: "arme-poing", basePath: "/boutique/categorie/arme-poing", listName: "x" },
      route: "/boutique/categorie/arme-poing",
    })
    expect(categoryHref(wrapper, "Munitions")).toBe("/boutique/categorie/munition")
    expect(categoryHref(wrapper, "Tout le catalogue")).toBe("/boutique")
    expect(wrapper.find('.catlinks [aria-current="page"]').text()).toBe("Armes de poing")
  })

  it("keeps the other filters in a category's link, but not the page of results", async () => {
    pageAnswer.value = { page: 3, limit: 24, total: 100, totalPages: 5, hasMore: true }
    const wrapper = await mountSuspended(ShopCatalogue, {
      props: { category: "", basePath: "/boutique", listName: "x" },
      route: "/boutique?legalCategory=B&page=3",
    })
    expect(categoryHref(wrapper, "Munitions")).toBe("/boutique/categorie/munition?legalCategory=B")
  })

  describe("on a tag page", () => {
    const tagPage = { category: "", lockedTags: ["occasion"], basePath: "/boutique/tag/occasion", listName: "x" }

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

    it("links the categories and the whole catalogue cleanly, none of them as the current page", async () => {
      // The page's own tag stays on its page: carrying it would make filtered
      // duplicates crawlable (review of the SEO audit fix).
      const wrapper = await mountSuspended(ShopCatalogue, { props: tagPage, route: "/boutique/tag/occasion" })
      expect(categoryHref(wrapper, "Munitions")).toBe("/boutique/categorie/munition")
      expect(categoryHref(wrapper, "Tout le catalogue")).toBe("/boutique")
      expect(wrapper.find('.catlinks [aria-current="page"]').exists()).toBe(false)
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
      pageAnswer.value = { page: 3, limit: 24, total: 100, totalPages: 5, hasMore: true }
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

    it("holds the legal category, price and tag filters, not the search nor the categories", async () => {
      const wrapper = await mountSuspended(ShopCatalogue, {
        props: { category: "", basePath: "/boutique", listName: "x" },
        route: "/boutique",
      })
      const panel = wrapper.find("#shop-filters")
      expect(wrapper.find("button.filters__toggle").text()).toBe("Filtres")
      for (const selector of ["#shop-legal", "#shop-min", "#shop-max", ".tagf"]) {
        expect(panel.find(selector).exists()).toBe(true)
      }
      expect(panel.find("#shop-search").exists()).toBe(false)
      expect(panel.find(".catlinks").exists()).toBe(false)
    })
  })

  it("says the price bounds are tax included, like the prices shown", async () => {
    const wrapper = await mountSuspended(ShopCatalogue, {
      props: { category: "", basePath: "/boutique", listName: "x" },
      route: "/boutique",
    })
    expect(wrapper.find("label[for='shop-min']").text()).toBe("Prix minimum TTC")
    expect(wrapper.find("label[for='shop-max']").text()).toBe("Prix maximum TTC")
    expect(wrapper.find("#shop-min").attributes("placeholder")).toBe("Min € TTC")
    expect(wrapper.find("#shop-max").attributes("placeholder")).toBe("Max € TTC")
  })
})

describe("ShopCatalogue pagination (SEO audit 2026-11-15, findings 1 and 13)", () => {
  // A page of results; the cards themselves are ProductCard's own business.
  const stubs = { global: { stubs: { ProductCard: true } } }
  beforeEach(() => {
    pageAnswer.products = [{ id: "p1", slug: "carabine", name: "Carabine" }]
  })
  afterEach(async () => {
    await clearError()
    pageAnswer.products = []
    pageAnswer.value = { page: 1, limit: 24, total: 0, totalPages: 0, hasMore: false }
  })

  it("links the next page with a real href, keeping the filters", async () => {
    pageAnswer.value = { page: 1, limit: 24, total: 60, totalPages: 3, hasMore: true }
    const wrapper = await mountSuspended(ShopCatalogue, {
      props: { category: "", basePath: "/boutique", listName: "x" },
      route: "/boutique?legalCategory=B",
      ...stubs,
    })
    expect(wrapper.find('a[rel="next"]').attributes("href")).toBe("/boutique?legalCategory=B&page=2")
  })

  it("answers 404 to a page past the last one, instead of an empty page", async () => {
    pageAnswer.value = { page: 9, limit: 24, total: 60, totalPages: 3, hasMore: false }
    // The test renderer still renders after a fatal error, which the browser
    // never does: only the error Nuxt records matters here.
    await mountSuspended(ShopCatalogue, {
      props: { category: "", basePath: "/boutique", listName: "x" },
      route: "/boutique?page=9",
      global: { stubs: { ProductCard: true }, config: { errorHandler: () => undefined } },
    }).catch(() => undefined)
    expect(useError().value).toMatchObject({ statusCode: 404 })
  })
})

// SEO audit 2026-11-15, finding 12: a page kept out of the indexes (an empty
// tag, an empty universe) sent a canonical too — contradictory signals.
describe("ShopCatalogue on a page kept out of the indexes", () => {
  // A path no other test uses: the document outlives each mount.
  const PATH = "/boutique/tag/noindex-check"
  const canonicals = () =>
    [...document.head.querySelectorAll('link[rel="canonical"]')].map((link) => link.getAttribute("href") ?? "")

  it("states no canonical when the page is noindex", async () => {
    await mountSuspended(ShopCatalogue, {
      props: { category: "", lockedTags: ["noindex-check"], basePath: PATH, listName: "x", noindex: true },
      route: PATH,
      global: { stubs: { ProductCard: true } },
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(canonicals().filter((href) => href.endsWith(PATH))).toEqual([])
  })

  it("states it otherwise", async () => {
    await mountSuspended(ShopCatalogue, {
      props: { category: "", lockedTags: ["noindex-check"], basePath: `${PATH}-on`, listName: "x" },
      route: `${PATH}-on`,
      global: { stubs: { ProductCard: true } },
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(canonicals().some((href) => href.endsWith(`${PATH}-on`))).toBe(true)
  })
})
