// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"
import ArtistPage from "./[slug].vue"

const { artist } = vi.hoisted(() => ({
  artist: {
    value: {
      id: "ar1",
      slug: "camille-vasseur",
      name: "Camille Vasseur",
      headline: "Photographe de l'objet",
      bio: "Une bio.",
      journey: "Un parcours.",
      portraitUrl: null as string | null,
      metaTitle: null,
      metaDescription: null,
      book: { title: "Matières armées", url: "https://www.amazon.fr/dp/2010000001" } as {
        title: string
        url: string
      } | null,
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
        },
      ],
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
    },
  },
}))

mockNuxtImport("useFetch", () => () => ({ data: ref({ data: artist.value }), error: ref(null) }))

const mounted = () => mountSuspended(ArtistPage, { route: "/collection/artiste/camille-vasseur" })

beforeEach(() => {
  artist.value = { ...artist.value, book: { title: "Matières armées", url: "https://www.amazon.fr/dp/2010000001" } }
})

describe("collection/artiste/[slug].vue", () => {
  it("shows the name, the headline, the bio and the journey", async () => {
    const wrapper = await mounted()
    expect(wrapper.find("h1").text()).toBe("Camille Vasseur")
    const text = wrapper.text()
    expect(text).toContain("Photographe de l'objet")
    expect(text).toContain("Une bio.")
    expect(text).toContain("Un parcours.")
  })

  /**
   * The book link is an affiliate link: it must open in a new tab and be
   * declared `sponsored`, so the outgoing link never passes ranking signal.
   */
  it("renders the book as a sponsored link opening in a new tab", async () => {
    const wrapper = await mounted()
    const link = wrapper.find('a[href^="https://www.amazon.fr"]')
    expect(link.exists()).toBe(true)
    expect(link.attributes("target")).toBe("_blank")
    expect(link.attributes("rel")).toBe("sponsored noopener")
    expect(link.text()).toContain("Matières armées")
    // The new tab is announced to screen readers rather than being a surprise.
    expect(link.text()).toContain("nouvel onglet")
  })

  it("renders no book link at all when the API reports none", async () => {
    artist.value = { ...artist.value, book: null }
    const wrapper = await mounted()
    expect(wrapper.find('a[href^="https://www.amazon.fr"]').exists()).toBe(false)
  })

  it("lists the series and the body of work", async () => {
    const wrapper = await mounted()
    const hrefs = wrapper.findAll("a").map((a) => a.attributes("href"))
    expect(hrefs).toContain("/collection/serie/age-d-or")
    expect(hrefs).toContain("/collection/eclat-de-bronze")
  })

  it("does not reserve a portrait column when there is no portrait", async () => {
    const wrapper = await mounted()
    expect(wrapper.find(".hero").classes()).not.toContain("hero--portrait")

    artist.value = { ...artist.value, portraitUrl: "https://example.test/p.jpg" }
    const withPortrait = await mounted()
    expect(withPortrait.find(".hero").classes()).toContain("hero--portrait")
    artist.value = { ...artist.value, portraitUrl: null }
  })
})
