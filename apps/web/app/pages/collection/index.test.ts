// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it, vi } from "vitest"
import { ref } from "vue"
import CollectionPage from "./index.vue"

const { payload } = vi.hoisted(() => ({
  payload: {
    artworks: [
      {
        id: "a1",
        slug: "eclat-de-bronze",
        title: "Éclat de Bronze",
        artistName: "Camille Vasseur",
        artistSlug: "camille-vasseur",
        series: { slug: "age-d-or", title: "Âge d'or" },
        description: null,
        featuredImageUrl: null,
        orientation: "landscape",
        editionLimit: 25,
        editionYear: 2025,
        availableCount: 5,
        soldCount: 2,
        priceFromHt: 180,
        priceFromTtc: 216,
      },
    ],
    series: [
      {
        id: "s1",
        slug: "age-d-or",
        title: "Âge d'or",
        intro: "Une série.",
        reference: "Un film",
        coverImageUrl: null,
        theme: { slug: "cinema", name: "Cinéma" },
        artist: { slug: "camille-vasseur", name: "Camille Vasseur" },
        artworkCount: 2,
      },
      // Nothing published inside: advertising it would be a dead end.
      {
        id: "s2",
        slug: "serie-vide",
        title: "Série vide",
        intro: null,
        reference: null,
        coverImageUrl: null,
        theme: null,
        artist: null,
        artworkCount: 0,
      },
    ],
    themes: [
      { id: "t1", slug: "cinema", name: "Cinéma", description: null, seriesCount: 1 },
      { id: "t2", slug: "vide", name: "Thème vide", description: null, seriesCount: 0 },
    ],
  },
}))

mockNuxtImport("useFetch", () => (url: string) => {
  if (typeof url === "string" && url.includes("/artworks/series")) {
    return { data: ref({ data: payload.series }), error: ref(null) }
  }
  if (typeof url === "string" && url.includes("/artworks/themes")) {
    return { data: ref({ data: payload.themes }), error: ref(null) }
  }
  return { data: ref({ data: payload.artworks }), error: ref(null) }
})

describe("collection/index.vue — editorial navigation (story 11.6)", () => {
  it("offers the series as an entry point, above the flat grid", async () => {
    const wrapper = await mountSuspended(CollectionPage, { route: "/collection" })
    const hrefs = wrapper.findAll("a").map((a) => a.attributes("href"))
    expect(hrefs).toContain("/collection/serie/age-d-or")
    expect(wrapper.text()).toContain("Les séries")
    expect(wrapper.text()).toContain("Toutes les œuvres")
  })

  it("never advertises an empty series or a theme with no series", async () => {
    const wrapper = await mountSuspended(CollectionPage, { route: "/collection" })
    const hrefs = wrapper.findAll("a").map((a) => a.attributes("href"))
    expect(hrefs).not.toContain("/collection/serie/serie-vide")
    expect(hrefs).not.toContain("/collection/theme/vide")
    expect(hrefs).toContain("/collection/theme/cinema")
  })

  it("still renders the grid when the editorial calls come back empty", async () => {
    const saved = { ...payload }
    payload.series = []
    payload.themes = []
    const wrapper = await mountSuspended(CollectionPage, { route: "/collection" })
    expect(wrapper.find(".serieslist").exists()).toBe(false)
    expect(wrapper.findAll(".grid li")).toHaveLength(1)
    payload.series = saved.series
    payload.themes = saved.themes
  })
})
