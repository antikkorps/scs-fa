// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import { ref } from "vue"
import SeriesPage from "./[slug].vue"

const artwork = (slug: string, title: string) => ({
  id: slug,
  slug,
  title,
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
})

const series = {
  id: "s1",
  slug: "age-d-or",
  title: "Âge d'or",
  intro: "Une série sur l'armurerie d'avant-guerre.",
  reference: "Le cinéma d'espionnage des années 1960",
  coverImageUrl: null,
  theme: { slug: "cinema", name: "Cinéma" },
  artist: { slug: "camille-vasseur", name: "Camille Vasseur" },
  artworkCount: 2,
  // The API already orders these; the page must not reshuffle them.
  artworks: [artwork("eclat-de-bronze", "Éclat de Bronze"), artwork("memoire-de-poudre", "Mémoire de Poudre")],
}

mockNuxtImport("useFetch", () => () => ({ data: ref({ data: series }), error: ref(null) }))

const mounted = () => mountSuspended(SeriesPage, { route: "/collection/serie/age-d-or" })

describe("collection/serie/[slug].vue", () => {
  it("leads with the presentation text — the series is an editorial unit", async () => {
    const wrapper = await mounted()
    expect(wrapper.find("h1").text()).toBe("Âge d'or")
    expect(wrapper.text()).toContain("Une série sur l'armurerie d'avant-guerre.")
    expect(wrapper.text()).toContain("Le cinéma d'espionnage des années 1960")
  })

  it("links to the artist and to the theme", async () => {
    const wrapper = await mounted()
    const hrefs = wrapper.findAll("a").map((a) => a.attributes("href"))
    expect(hrefs).toContain("/collection/artiste/camille-vasseur")
    expect(hrefs).toContain("/collection/theme/cinema")
  })

  it("renders the artworks in the order the API returned them", async () => {
    const wrapper = await mounted()
    const cards = wrapper.findAll(".grid li")
    expect(cards).toHaveLength(2)
    expect(cards[0]?.text()).toContain("Éclat de Bronze")
    expect(cards[1]?.text()).toContain("Mémoire de Poudre")
  })
})
