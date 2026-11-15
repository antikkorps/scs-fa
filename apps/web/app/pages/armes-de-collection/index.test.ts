// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"
import CollectionPage from "./index.vue"

const { listing } = vi.hoisted(() => ({
  listing: { pagination: { page: 1, limit: 24, total: 60, totalPages: 3, hasMore: true } },
}))

const WEAPON = {
  id: "w1",
  slug: "fusil-gras-1874",
  name: "Fusil Gras 1874",
  available: true,
  period: "1870-1914",
  legalCategory: "D",
  description: "Arme réglementaire de l'armée française.",
  makerName: "Manufacture de Saint-Étienne",
  condition: "Bon état",
  priceTtc: "1200.00",
  featuredImageUrl: null,
}

mockNuxtImport("useFetch", () => (url: string) => {
  if (url.includes("/tags")) return { data: ref({ data: [] }), error: ref(null) }
  return {
    data: ref({ data: [WEAPON], pagination: listing.pagination }),
    error: ref(null),
    pending: ref(false),
  }
})

// The head is written to the document after the render, not during it.
const headWritten = () => new Promise((resolve) => setTimeout(resolve, 50))

describe("collection firearms listing (SEO audit 2026-11-15, findings 1 and 13)", () => {
  afterEach(async () => {
    listing.pagination = { page: 1, limit: 24, total: 60, totalPages: 3, hasMore: true }
    await clearError()
  })

  it("links the next page with a real href, keeping the filters", async () => {
    const wrapper = await mountSuspended(CollectionPage, { route: "/armes-de-collection?vendues=1" })
    expect(wrapper.find('a[rel="next"]').attributes("href")).toBe("/armes-de-collection?vendues=1&page=2")
  })

  it("numbers the title of a later page", async () => {
    await mountSuspended(CollectionPage, { route: "/armes-de-collection?page=2" })
    await headWritten()
    expect(document.title).toContain("Armes de collection & historiques — page 2")
  })

  it("answers 404 to a page past the last one", async () => {
    // The test renderer still renders the page after a fatal error, which the
    // browser never does: only the error Nuxt records matters here.
    await mountSuspended(CollectionPage, { route: "/armes-de-collection?page=9" }).catch(() => undefined)
    expect(useError().value).toMatchObject({ statusCode: 404 })
  })
})
