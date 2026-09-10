// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it, vi } from "vitest"
import { ref } from "vue"
import ThemePage from "./[slug].vue"

const { theme } = vi.hoisted(() => ({
  theme: {
    value: {
      id: "t1",
      slug: "cinema",
      name: "Cinéma",
      description: "Les armes telles que le cinéma les a fixées.",
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
      ] as unknown[],
    },
  },
}))

mockNuxtImport("useFetch", () => () => ({ data: ref({ data: theme.value }), error: ref(null) }))

const mounted = () => mountSuspended(ThemePage, { route: "/collection/theme/cinema" })

describe("collection/theme/[slug].vue", () => {
  it("presents the theme and the series it gathers", async () => {
    const wrapper = await mounted()
    expect(wrapper.find("h1").text()).toBe("Cinéma")
    expect(wrapper.text()).toContain("Les armes telles que le cinéma les a fixées.")
    expect(wrapper.findAll("a").map((a) => a.attributes("href"))).toContain("/collection/serie/age-d-or")
  })

  it("says so plainly rather than showing an empty page", async () => {
    theme.value = { ...theme.value, series: [] }
    const wrapper = await mounted()
    expect(wrapper.text()).toContain("Aucune série publiée sous ce thème")
    expect(wrapper.find(".serieslist").exists()).toBe(false)
  })
})
