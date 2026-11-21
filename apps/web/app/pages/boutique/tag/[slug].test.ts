// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { afterEach, describe, expect, it } from "vitest"
import { ref } from "vue"
import TagPage from "./[slug].vue"

// The shop menu the page reads; empty unless a test fills it.
const menu: unknown[] = []

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
  if (url.endsWith("/menu")) return { data: ref({ data: menu }), error: ref(null) }
  if (url.includes("/product-categories")) return { data: ref({ data: [] }), error: ref(null) }
  return {
    data: ref({ data: [], pagination: { page: 1, limit: 24, total: 60, totalPages: 3, hasMore: true } }),
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

  it("numbers the title of a later page of results (SEO audit 2026-11-15, finding 13)", async () => {
    await mountSuspended(TagPage, { route: "/boutique/tag/occasion?page=2" })
    await headWritten()
    expect(document.title).toContain("Occasion — Boutique armurerie — page 2")
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

  // Story 12.15c — a menu entry showing exactly this tag is the page to index.
  it("names as canonical the menu entry showing exactly this tag", async () => {
    menu.push({
      slug: "occasions",
      label: "Occasions",
      path: "/occasions",
      kind: "filter",
      href: "/occasions",
      filter: { category: null, subcategory: null, tags: ["occasion"], legalCategory: null },
      children: [],
    })
    await mountSuspended(TagPage, { route: "/boutique/tag/occasion" })
    await headWritten()
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toMatch(/\/occasions$/)
    menu.length = 0
  })
})
