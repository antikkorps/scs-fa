// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import CatalogPager from "./CatalogPager.vue"

// SEO audit 2026-11-15, finding 1: buttons gave crawlers no way past page 1.
const linkFor = (page: number) => ({ path: "/boutique", query: page > 1 ? { page: String(page) } : {} })

describe("CatalogPager", () => {
  it("links every page it shows with a real href, the first page without ?page", async () => {
    const wrapper = await mountSuspended(CatalogPager, { props: { page: 2, totalPages: 3, linkFor } })
    const hrefs = wrapper.findAll("a").map((link) => link.attributes("href"))
    expect(hrefs).toContain("/boutique")
    expect(hrefs).toContain("/boutique?page=3")
    expect(wrapper.find('a[rel="prev"]').attributes("href")).toBe("/boutique")
    expect(wrapper.find('a[rel="next"]').attributes("href")).toBe("/boutique?page=3")
  })

  it("marks the current page, and links nowhere past the ends", async () => {
    const wrapper = await mountSuspended(CatalogPager, { props: { page: 1, totalPages: 3, linkFor } })
    expect(wrapper.find('[aria-current="page"]').text()).toBe("1")
    expect(wrapper.find('a[rel="prev"]').exists()).toBe(false)
    expect(wrapper.find('[aria-disabled="true"]').text()).toContain("Précédent")
  })

  it("folds long runs of pages behind a gap", async () => {
    const wrapper = await mountSuspended(CatalogPager, { props: { page: 10, totalPages: 20, linkFor } })
    expect(wrapper.text()).toContain("…")
    expect(wrapper.find('a[href="/boutique?page=20"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/boutique?page=5"]').exists()).toBe(false)
  })
})
