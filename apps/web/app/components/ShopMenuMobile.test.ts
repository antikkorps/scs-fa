// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import { fetchWithShopMenu } from "../../tests/helpers/shopMenu"
import ShopMenuMobile from "./ShopMenuMobile.vue"

// Story 12.15c — the shop menu in the mobile overlay: a tab with children is an
// accordion, the others plain links.
mockNuxtImport("useFetch", () => fetchWithShopMenu)

async function expand(slug: string) {
  const wrapper = await mountSuspended(ShopMenuMobile)
  await wrapper.find(`button[aria-controls="msub-${slug}"]`).trigger("click")
  return wrapper
}

describe("ShopMenuMobile", () => {
  it("lists the tabs in the menu's order", async () => {
    const wrapper = await mountSuspended(ShopMenuMobile)
    const labels = wrapper.findAll(".mlink").map((row) => row.text().replace("›", "").trim())
    expect(labels.slice(0, 4)).toEqual(["Chasse", "Munitions", "Armes de défense", "Coutellerie"])
  })

  it("keeps a tab without children a plain link", async () => {
    const wrapper = await mountSuspended(ShopMenuMobile)
    expect(wrapper.find('a.mlink[href="/coutellerie"]').exists()).toBe(true)
    expect(wrapper.find('[aria-controls="msub-coutellerie"]').exists()).toBe(false)
  })

  it("starts collapsed", async () => {
    const wrapper = await mountSuspended(ShopMenuMobile)
    expect(wrapper.find('button[aria-controls="msub-chasse"]').attributes("aria-expanded")).toBe("false")
  })

  it("reveals the whole-tab link first, then the nested entries", async () => {
    const wrapper = await expand("chasse")
    expect(wrapper.find('button[aria-controls="msub-chasse"]').attributes("aria-expanded")).toBe("true")
    const links = wrapper.findAll("#msub-chasse a")
    expect(links[0]?.text()).toBe("Voir tout « Chasse »")
    expect(links[0]?.attributes("href")).toBe("/chasse")
    expect(wrapper.find('#msub-chasse a[href="/chasse/armes-longues"]').text()).toBe("Armes longues")
    expect(wrapper.find('#msub-chasse .msub__deep a[href="/chasse/armes-longues/fusils"]').exists()).toBe(true)
  })

  it("shows a heading without a page as plain text above its links", async () => {
    const wrapper = await expand("chasse")
    const heading = wrapper.findAll("#msub-chasse .msub__heading").find((node) => node.text() === "Accessoires")
    expect(heading?.element.tagName).not.toBe("A")
    expect(wrapper.find('#msub-chasse a[href="/chasse/accessoires/nettoyage"]').exists()).toBe(true)
  })

  it("ends with a link to the whole shop", async () => {
    const wrapper = await mountSuspended(ShopMenuMobile)
    expect(wrapper.find('a[href="/boutique"]').text()).toContain("Toute la boutique")
  })
})
