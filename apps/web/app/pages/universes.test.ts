// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref, toValue } from "vue"
import Chasse from "./chasse.vue"
import Coutellerie from "./coutellerie.vue"

// Story 12.13 — the two universe pages: an introduction, then the catalogue of
// what each gathers (a tag across categories, or a category).
const { productQueries } = vi.hoisted(() => ({ productQueries: [] as unknown[] }))

mockNuxtImport("useFetch", () => (url: string, opts?: { query?: unknown }) => {
  if (url.includes("/product-categories")) {
    return {
      data: ref({ data: [{ slug: "coutellerie", name: "Coutellerie", category: "coutellerie", displayOrder: 10 }] }),
      error: ref(null),
    }
  }
  if (url.includes("/tags")) return { data: ref({ data: [] }), error: ref(null) }
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
})

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
})
