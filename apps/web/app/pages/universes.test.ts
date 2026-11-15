// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref, toValue } from "vue"
import Chasse from "./chasse.vue"
import Coutellerie from "./coutellerie.vue"

// Story 12.13 — the two universe pages: an introduction, then the catalogue of
// what each gathers (a tag across categories, or a category).
const { productQueries, reference } = vi.hoisted(() => ({
  productQueries: [] as unknown[],
  // What the shop holds: the knife category, and the hunting tag with its product count.
  reference: { categories: ["coutellerie"], chasseProducts: 3 as number | null },
}))

mockNuxtImport("useFetch", () => (url: string, opts?: { query?: unknown }) => {
  if (url.includes("/product-categories")) {
    const rows = reference.categories.map((slug) => ({ slug, name: "Coutellerie", category: slug, displayOrder: 10 }))
    return { data: ref({ data: rows }), error: ref(null) }
  }
  if (url.includes("/tags")) {
    const tags =
      reference.chasseProducts === null
        ? []
        : [
            {
              slug: "chasse",
              name: "Chasse",
              facet: "usage",
              description: null,
              productCount: reference.chasseProducts,
            },
          ]
    return { data: ref({ data: [{ facet: "usage", tags }] }), error: ref(null) }
  }
  productQueries.push(toValue(opts?.query))
  return {
    data: ref({ data: [], pagination: { page: 1, limit: 24, total: 0, totalPages: 0, hasMore: false } }),
    error: ref(null),
    pending: ref(false),
  }
})

const headWritten = () => new Promise((resolve) => setTimeout(resolve, 50))

beforeEach(() => {
  productQueries.length = 0
  reference.categories = ["coutellerie"]
  reference.chasseProducts = 3
})

const robots = () => document.head.querySelector('meta[name="robots"]')?.getAttribute("content") ?? undefined

describe("universe pages (story 12.13)", () => {
  it("/chasse gathers every product tagged « chasse », whatever its category", async () => {
    const wrapper = await mountSuspended(Chasse, { route: "/chasse" })
    expect(wrapper.find("h1").text()).toBe("Chasse")
    expect(productQueries.at(-1)).toMatchObject({ tags: "chasse" })
    expect(productQueries.at(-1)).not.toHaveProperty("category")
    await headWritten()
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toMatch(/\/chasse$/)
  })

  it("/coutellerie lists the knife category, and says the sale is for adults", async () => {
    const wrapper = await mountSuspended(Coutellerie, { route: "/coutellerie" })
    expect(wrapper.find("h1").text()).toBe("Coutellerie")
    expect(productQueries.at(-1)).toMatchObject({ category: "coutellerie" })
    expect(wrapper.text()).toContain("18 ans et plus")
    // Its own aisle is the current one in the category row.
    expect(wrapper.find('.catlinks [aria-current="page"]').text()).toBe("Coutellerie")
  })

  // Review of #260: an empty universe is a thin page; a missing one is a 404.
  it("keeps /chasse out of the indexes while no product carries the tag", async () => {
    reference.chasseProducts = 0
    await mountSuspended(Chasse, { route: "/chasse" })
    await headWritten()
    expect(robots()).toBe("noindex, follow")
  })

  it("answers 404 when the universe's tag or category does not exist", async () => {
    reference.categories = []
    await mountSuspended(Coutellerie, { route: "/coutellerie" }).catch(() => undefined)
    expect(useError().value).toMatchObject({ statusCode: 404 })
    await clearError()
  })
})
