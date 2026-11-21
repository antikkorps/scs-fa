// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref, toValue } from "vue"
import MenuEntryPage from "./[...menuPath].vue"

// Story 12.15c — the page of a menu entry: its texts, its trail, its sub-entries,
// then the catalogue under the entry's saved filter.
const { productQueries, pages } = vi.hoisted(() => ({
  productQueries: [] as unknown[],
  pages: new Map<string, unknown>(),
}))

const filterEntry = (path: string, label: string) => ({
  slug: path.split("/").at(-1),
  label,
  path,
  kind: "filter",
  href: path,
  filter: { category: null, subcategory: null, tags: [], legalCategory: null },
  children: [],
})

const ARMES_LONGUES = {
  label: "Armes longues",
  path: "/tir-sportif/armes-longues",
  description: null,
  intro: "Premier paragraphe.\n\nSecond paragraphe.",
  filter: { category: "arme-longue", subcategory: "carabines", tags: ["tir-sportif"], legalCategory: "B" },
  breadcrumb: [
    { label: "Tir sportif", href: "/tir-sportif" },
    { label: "Rubrique", href: null },
  ],
  children: [
    filterEntry("/tir-sportif/armes-longues/categorie-c", "Catégorie C"),
    {
      ...filterEntry("/tir-sportif/armes-longues/rangement", "Rangement"),
      kind: "group",
      href: null,
      filter: null,
      children: [filterEntry("/tir-sportif/armes-longues/rangement/valises", "Valises")],
    },
  ],
  productCount: 4,
}

mockNuxtImport("useFetch", () => (url: string, opts?: { query?: unknown }) => {
  const query = toValue(opts?.query) as Record<string, string> | undefined
  if (url.endsWith("/menu/page")) {
    const page = pages.get(String(toValue(query?.path)))
    return { data: ref(page ? { data: page } : null), error: ref(page ? null : { statusCode: 404 }) }
  }
  if (url.endsWith("/menu")) return { data: ref({ data: [] }), error: ref(null) }
  if (url.includes("/product-categories") || url.includes("/tags")) return { data: ref({ data: [] }), error: ref(null) }
  productQueries.push(query)
  return {
    data: ref({ data: [], pagination: { page: 1, limit: 24, total: 0, totalPages: 0, hasMore: false } }),
    error: ref(null),
    pending: ref(false),
  }
})

const headWritten = () => new Promise((resolve) => setTimeout(resolve, 50))
const robots = () => document.head.querySelector('meta[name="robots"]')?.getAttribute("content") ?? undefined
const mountAt = (path: string) => mountSuspended(MenuEntryPage, { route: path })

beforeEach(() => {
  productQueries.length = 0
  pages.clear()
  pages.set(ARMES_LONGUES.path, ARMES_LONGUES)
})

describe("a menu entry's page", () => {
  it("shows the entry's name, introduction and trail", async () => {
    const wrapper = await mountAt(ARMES_LONGUES.path)
    expect(wrapper.find("h1").text()).toBe("Armes longues")
    expect(wrapper.findAll(".intro__lede p").map((p) => p.text())).toEqual([
      "Premier paragraphe.",
      "Second paragraphe.",
    ])
    expect(wrapper.find(".crumbs").text()).toMatch(/Boutique.*Tir sportif.*Rubrique.*Armes longues/s)
    expect(wrapper.find('.crumbs a[href="/tir-sportif"]').exists()).toBe(true)
  })

  it("lists the catalogue under the entry's whole filter", async () => {
    await mountAt(ARMES_LONGUES.path)
    expect(productQueries.at(-1)).toMatchObject({
      category: "arme-longue",
      subcategory: "carabines",
      tags: "tir-sportif",
      legalCategory: "B",
    })
  })

  // A heading has no page: its own entries stand in its place.
  it("links the sub-entries, a heading's in its place", async () => {
    const wrapper = await mountAt(ARMES_LONGUES.path)
    expect(wrapper.findAll(".subentries a").map((a) => a.attributes("href"))).toEqual([
      "/tir-sportif/armes-longues/categorie-c",
      "/tir-sportif/armes-longues/rangement/valises",
    ])
  })

  it("composes a description from the trail when none is written", async () => {
    await mountAt(ARMES_LONGUES.path)
    await headWritten()
    const description = document.head.querySelector('meta[name="description"]')?.getAttribute("content")
    expect(description).toContain("Armes longues")
    expect(description).toContain("Tir sportif")
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toMatch(
      /\/tir-sportif\/armes-longues$/,
    )
  })

  it("keeps an entry no product fills yet out of the indexes", async () => {
    pages.set(ARMES_LONGUES.path, { ...ARMES_LONGUES, productCount: 0 })
    await mountAt(ARMES_LONGUES.path)
    await headWritten()
    expect(robots()).toBe("noindex, follow")
  })

  it("answers 404 where the menu has no page", async () => {
    await mountAt("/nulle-part").catch(() => undefined)
    expect(useError().value).toMatchObject({ statusCode: 404 })
    await clearError()
  })
})
