// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { afterEach, describe, expect, it } from "vitest"
import { ref } from "vue"
import type { ShopMenuEntry } from "../../shared/utils/menu"
import { isShown } from "../../tests/helpers/panel"
import { fetchWithShopMenu, SHOP_MENU } from "../../tests/helpers/shopMenu"
import ShopMenuBar from "./ShopMenuBar.vue"

// Story 12.15c — the header's second row: the shop menu's tabs, as Fred edits
// them in the back-office, each with its mega-panel.
// A test may swap the menu for one of its own.
let ownMenu: ShopMenuEntry[] | null = null
mockNuxtImport(
  "useFetch",
  () => (url: string) =>
    ownMenu && url.endsWith("/menu") ? { data: ref({ data: ownMenu }), error: ref(null) } : fetchWithShopMenu(url),
)
// The row's widths do not exist in the test DOM: a test sets how many fit.
const fitting = ref(Number.POSITIVE_INFINITY)
mockNuxtImport("useTabOverflow", () => () => fitting)
afterEach(() => {
  ownMenu = null
  fitting.value = Number.POSITIVE_INFINITY
})

async function openTab(slug: string) {
  const wrapper = await mountSuspended(ShopMenuBar)
  // Keyboard focus opens it like hover (pointerenter does not bubble from the
  // label; MegaMenuItem's own test covers the hover).
  await wrapper.find(`a[aria-controls="mega-${slug}"]`).trigger("focusin")
  return wrapper
}

describe("ShopMenuBar", () => {
  it("draws the menu's tabs, in the menu's order, as « Nos univers »", async () => {
    const wrapper = await mountSuspended(ShopMenuBar)
    expect(wrapper.find("nav").attributes("aria-label")).toBe("Navigation principale")
    expect(wrapper.find(".shop-bar__universes").attributes("aria-label")).toBe("Nos univers")
    const labels = wrapper.findAll(".shop-tab .shop-tab__link").map((link) => link.text())
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
    expect(wrapper.find("#mega-armes-de-defense").exists()).toBe(false)
  })

  it("tells the header which panel is open, and says it on the tab", async () => {
    const wrapper = await openTab("munitions")
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual(["munitions"])
    expect(wrapper.find('a[aria-controls="mega-munitions"]').attributes("aria-expanded")).toBe("true")
  })

  // Review of 12.15c (UI/UX): the row says what the tabs are, and its label
  // leads to the whole shop.
  it("opens the row with « Nos univers », a link to the whole shop", async () => {
    const wrapper = await mountSuspended(ShopMenuBar)
    const label = wrapper.find("nav > a:first-child")
    expect(label.attributes("href")).toBe("/boutique")
    expect(label.text()).toContain("Nos univers")
  })

  it("ends the row with the house's two signatures, set apart and highlighted", async () => {
    const wrapper = await mountSuspended(ShopMenuBar)
    const signatures = wrapper.find(".shop-bar__signatures")
    expect(signatures.attributes("aria-label")).toBe("Signatures de la maison")
    const links = signatures.findAll("a.nav__link--feature").map((link) => link.attributes("href"))
    expect(links).toEqual(["/armes-de-collection", "/collection"])
  })

  it("opens a panel for each signature, so both behave alike", async () => {
    const wrapper = await mountSuspended(ShopMenuBar)
    await wrapper.find('a[aria-controls="mega-collection"]').trigger("focusin")
    expect(isShown(wrapper.find("#mega-collection"))).toBe(true)
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual(["collection"])
    expect(wrapper.find('#mega-gunart a[href="/collection/artiste"]').exists()).toBe(true)
  })

  it("keeps the deep links in the page with the panels closed", async () => {
    const wrapper = await mountSuspended(ShopMenuBar)
    expect(wrapper.find('#mega-chasse a[href="/chasse/armes-longues/carabines"]').exists()).toBe(true)
  })

  it("moves the tabs that do not fit under « Plus », keeping them in the page", async () => {
    fitting.value = 2
    const wrapper = await mountSuspended(ShopMenuBar)
    const spilled = wrapper.findAll(".shop-tab--spilled .shop-tab__link").map((link) => link.text())
    expect(spilled).toEqual(["Armes de défense", "Coutellerie"])
    const more = wrapper.find("#mega-plus")
    expect(more.findAll("a.mega__heading").map((link) => link.text())).toEqual(["Armes de défense", "Coutellerie"])
    expect(wrapper.find('button[aria-controls="mega-plus"]').text()).toBe("Plus")
  })

  it("hides « Plus » while every tab fits", async () => {
    const wrapper = await mountSuspended(ShopMenuBar)
    expect(wrapper.find(".shop-more").classes()).toContain("shop-more--idle")
    expect(wrapper.find(".shop-tab--spilled").exists()).toBe(false)
  })

  // Review of 12.15c: a heading has no page. As an <a> without href its tab
  // could not take the keyboard focus that opens its panel.
  it("draws a heading tab as a button and a leaf without a page as text", async () => {
    const group = { ...SHOP_MENU[0], kind: "group", href: null } as ShopMenuEntry
    const [column] = group.children
    const [leaf] = column?.children ?? []
    const leafless = { ...column, children: [{ ...leaf, href: null }] }
    ownMenu = [{ ...group, children: [leafless as ShopMenuEntry] }]
    const wrapper = await mountSuspended(ShopMenuBar)
    const trigger = wrapper.find('button[aria-controls="mega-chasse"]')
    expect(trigger.exists()).toBe(true)
    await trigger.trigger("focusin")
    expect(wrapper.find("#mega-chasse").text()).toContain("Fusils")
    expect(wrapper.findAll("#mega-chasse a.mega__link")).toHaveLength(0)
  })
})
