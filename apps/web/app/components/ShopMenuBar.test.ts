// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import { fetchWithShopMenu } from "../../tests/helpers/shopMenu"
import ShopMenuBar from "./ShopMenuBar.vue"

// Story 12.15c — the header's second row: the shop menu's tabs, as Fred edits
// them in the back-office, each with its mega-panel.
mockNuxtImport("useFetch", () => fetchWithShopMenu)

async function openTab(slug: string) {
  const wrapper = await mountSuspended(ShopMenuBar)
  // Keyboard focus opens it like hover (pointerenter does not bubble from the
  // label; MegaMenuItem's own test covers the hover).
  await wrapper.find(`a[aria-controls="mega-${slug}"]`).trigger("focusin")
  return wrapper
}

describe("ShopMenuBar", () => {
  it("draws the menu's tabs, in the menu's order, under a named landmark", async () => {
    const wrapper = await mountSuspended(ShopMenuBar)
    expect(wrapper.find("nav").attributes("aria-label")).toBe("Rayons de la boutique")
    const labels = wrapper.findAll(".shop-tab__link").map((link) => link.text())
    expect(labels).toEqual(["Chasse", "Munitions", "Armes de défense", "Coutellerie"])
  })

  it("links each tab to its page", async () => {
    const wrapper = await mountSuspended(ShopMenuBar)
    expect(wrapper.find('.shop-tab__link[href="/chasse"]').exists()).toBe(true)
    expect(wrapper.find('.shop-tab__link[href="/coutellerie"]').exists()).toBe(true)
  })

  it("opens a tab's panel with a column per sub-entry and its links below", async () => {
    const wrapper = await openTab("chasse")
    const panel = wrapper.find("#mega-chasse")
    expect(panel.findAll(".mega__col")).toHaveLength(3)
    expect(panel.find('a.mega__heading[href="/chasse/armes-longues"]').text()).toBe("Armes longues")
    expect(panel.find('a.mega__link[href="/chasse/armes-longues/fusils"]').text()).toBe("Fusils")
    expect(panel.find('a.mega__link[href="/chasse/accessoires/appeaux"]').exists()).toBe(true)
  })

  it("shows a heading without a page as plain text", async () => {
    const wrapper = await openTab("chasse")
    const heading = wrapper.findAll("#mega-chasse .mega__heading").find((node) => node.text() === "Accessoires")
    expect(heading?.element.tagName).not.toBe("A")
  })

  it("ends the panel with a link to the whole tab", async () => {
    const wrapper = await openTab("chasse")
    const cta = wrapper.find('#mega-chasse a.mega__cta[href="/chasse"]')
    expect(cta.text()).toContain("Tout « Chasse »")
  })

  it("keeps a tab without children a plain link, with no panel", async () => {
    const wrapper = await mountSuspended(ShopMenuBar)
    const link = wrapper.find('.shop-tab__link[href="/armes-de-defense"]')
    expect(link.attributes("aria-controls")).toBeUndefined()
    await link.trigger("pointerenter")
    expect(wrapper.find(".mega").exists()).toBe(false)
  })

  it("tells the header which panel is open, and says it on the tab", async () => {
    const wrapper = await openTab("munitions")
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual(["munitions"])
    expect(wrapper.find('a[aria-controls="mega-munitions"]').attributes("aria-expanded")).toBe("true")
  })

  it("ends the row with a link to the whole shop", async () => {
    const wrapper = await mountSuspended(ShopMenuBar)
    expect(wrapper.find('a.shop-bar__all[href="/boutique"]').text()).toContain("Toute la boutique")
  })
})
