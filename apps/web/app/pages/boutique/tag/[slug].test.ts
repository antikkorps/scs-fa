// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { afterEach, describe, expect, it } from "vitest"
import { ref } from "vue"
import TagPage from "./[slug].vue"

const TAGS = [
  {
    facet: "etat",
    tags: [
      {
        slug: "occasion",
        name: "Occasion",
        facet: "etat",
        description: "Révisées par notre atelier.",
        productCount: 3,
      },
      { slug: "neuf", name: "Neuf", facet: "etat", description: null, productCount: 0 },
    ],
  },
]

mockNuxtImport("useFetch", () => (url: string) => {
  if (url.includes("/tags")) return { data: ref({ data: TAGS }), error: ref(null) }
  if (url.includes("/product-categories")) return { data: ref({ data: [] }), error: ref(null) }
  return {
    data: ref({ data: [], pagination: { page: 1, limit: 24, total: 0, totalPages: 0, hasMore: false } }),
    error: ref(null),
    pending: ref(false),
  }
})

// The head is written to the document after the render, not during it.
const headWritten = () => new Promise((resolve) => setTimeout(resolve, 50))

function robots(): string | undefined {
  return document.head.querySelector('meta[name="robots"]')?.getAttribute("content") ?? undefined
}

describe("tag page", () => {
  afterEach(async () => {
    await clearError()
  })

  it("names the tag and says what it gathers", async () => {
    const wrapper = await mountSuspended(TagPage, { route: "/boutique/tag/occasion" })
    expect(wrapper.find("h1").text()).toBe("Occasion")
    expect(wrapper.text()).toContain("Révisées par notre atelier.")
    await headWritten()
    expect(robots()).toBeUndefined()
  })

  it("is a real 404 for a tag that does not exist", async () => {
    await mountSuspended(TagPage, { route: "/boutique/tag/inconnu" })
    expect(useError().value).toMatchObject({ statusCode: 404 })
  })

  it("keeps a tag no product carries out of the indexes", async () => {
    await mountSuspended(TagPage, { route: "/boutique/tag/neuf" })
    await headWritten()
    expect(robots()).toBe("noindex, follow")
  })
})
