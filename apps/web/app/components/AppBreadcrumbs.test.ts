// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import AppBreadcrumbs from "./AppBreadcrumbs.vue"

describe("AppBreadcrumbs (story 9.6)", () => {
  const items = [
    { name: "Boutique", to: "/boutique" },
    { name: "Munitions", to: "/boutique/categorie/munition" },
    { name: "9×19" },
  ]

  it("links every crumb but the current page, which is marked as such", async () => {
    const wrapper = await mountSuspended(AppBreadcrumbs, { props: { items } })
    expect(wrapper.findAll("a").map((a) => a.attributes("href"))).toEqual(["/boutique", "/boutique/categorie/munition"])
    const current = wrapper.find('[aria-current="page"]')
    expect(current.text()).toBe("9×19")
    expect(wrapper.find("nav").attributes("aria-label")).toBe("Fil d'Ariane")
  })

  it("never turns the current page into a link, even when given a URL", async () => {
    const wrapper = await mountSuspended(AppBreadcrumbs, { props: { items: [{ name: "Boutique", to: "/boutique" }] } })
    expect(wrapper.findAll("a")).toHaveLength(0)
  })

  // Story 12.15c — a menu heading has no page: named in the trail, not linked, not current.
  it("names a crumb without a page, without marking it current", async () => {
    const trail = [{ name: "Chasse", to: "/chasse" }, { name: "Accessoires" }, { name: "Nettoyage" }]
    const wrapper = await mountSuspended(AppBreadcrumbs, { props: { items: trail } })
    expect(wrapper.findAll('[aria-current="page"]').map((crumb) => crumb.text())).toEqual(["Nettoyage"])
    expect(wrapper.text()).toContain("Accessoires")
  })
})
