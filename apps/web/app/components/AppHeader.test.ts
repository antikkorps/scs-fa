// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { nextTick, ref } from "vue"
import { isShown } from "../../tests/helpers/panel"
import { fetchWithShopMenu } from "../../tests/helpers/shopMenu"
import AppHeader from "./AppHeader.vue"

// Real refs so Vue auto-unwraps them in the template (plain objects would read
// as always-truthy and never reactive).
const isAuthenticated = ref(false)
const isAdmin = ref(false)
const cartCount = ref(0)
const user = ref<{ firstName: string } | null>({ firstName: "Jean" })
const logout = vi.fn()

mockNuxtImport("useAuth", () => () => ({ isAuthenticated, isAdmin, user, logout }))
mockNuxtImport("useCart", () => () => ({ count: cartCount }))
mockNuxtImport("useFetch", () => fetchWithShopMenu)

beforeEach(() => {
  isAuthenticated.value = false
  isAdmin.value = false
  cartCount.value = 0
})

describe("AppHeader", () => {
  // Review of 12.15c (UI/UX): the first row is the house, the second
  // everything one buys, the two signatures included.
  it("keeps only the journal and the house in the first row", async () => {
    const wrapper = await mountSuspended(AppHeader)
    const links = wrapper.findAll(".hdr__bar .nav__link").map((link) => link.text())
    expect(links).toEqual(["Journal", "À propos"])
  })

  it("highlights the collection and Gun Art in the second row", async () => {
    const wrapper = await mountSuspended(AppHeader)
    const featured = wrapper.findAll(".hdr__shop .nav__link--feature").map((link) => link.attributes("href"))
    expect(featured).toEqual(["/armes-de-collection", "/gun-art"])
  })

  it("draws the shop menu's tabs in a second row", async () => {
    const wrapper = await mountSuspended(AppHeader)
    const tabs = wrapper.findAll(".hdr__shop .shop-tab .shop-tab__link").map((link) => link.text())
    expect(tabs).toEqual(["Chasse", "Munitions", "Armes de défense", "Coutellerie"])
  })

  it("no longer has the Armurerie mega-menu nor the legal-category links", async () => {
    const wrapper = await mountSuspended(AppHeader)
    expect(wrapper.find('[aria-controls="mega-armurerie"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain("Armurerie")
    expect(wrapper.find('a[href*="legalCategory"]').exists()).toBe(false)
  })

  it("keeps a single panel open between Gun Art and the shop tabs", async () => {
    const wrapper = await mountSuspended(AppHeader)
    await wrapper.find('a[aria-controls="mega-chasse"]').trigger("focusin")
    expect(isShown(wrapper.find("#mega-chasse"))).toBe(true)
    await wrapper.find('a[aria-controls="mega-gunart"]').trigger("focusin")
    expect(isShown(wrapper.find("#mega-chasse"))).toBe(false)
    expect(isShown(wrapper.find("#mega-gunart"))).toBe(true)
  })

  it("shows a cart badge only when there are items", async () => {
    cartCount.value = 2
    const wrapper = await mountSuspended(AppHeader)
    expect(wrapper.find(".cart__badge").text()).toBe("2")
  })

  it("account menu offers login/signup when signed out", async () => {
    const wrapper = await mountSuspended(AppHeader)
    await wrapper.find('button[aria-label="Mon compte"]').trigger("click")
    expect(wrapper.find(".menu").text()).toContain("Connexion")
    expect(wrapper.find(".menu").text()).toContain("Créer un compte")
  })

  it("account menu offers admin + logout when signed in as admin", async () => {
    isAuthenticated.value = true
    isAdmin.value = true
    const wrapper = await mountSuspended(AppHeader)
    await wrapper.find('button[aria-label="Mon compte"]').trigger("click")
    const menu = wrapper.find(".menu").text()
    expect(menu).toContain("Administration")
    expect(menu).toContain("Déconnexion")
  })

  it("opens the Gun Art mega-menu with a link to the collection", async () => {
    const wrapper = await mountSuspended(AppHeader)
    // The label is a link to the collection, not a toggle: the panel opens on
    // hover and on keyboard focus, so a click never has to undo it.
    expect(isShown(wrapper.find("#mega-gunart"))).toBe(false)
    await wrapper.find('a[aria-controls="mega-gunart"]').trigger("focusin")
    const mega = wrapper.find("#mega-gunart")
    expect(isShown(mega)).toBe(true)
    expect(mega.find('a[href="/gun-art"]').exists()).toBe(true)
  })

  it("toggles the search overlay (teleported to body)", async () => {
    const wrapper = await mountSuspended(AppHeader)
    expect(document.querySelector(".searchov")).toBeNull()
    await wrapper.find('button[aria-label="Rechercher"]').trigger("click")
    expect(document.querySelector(".searchov")).not.toBeNull()
    wrapper.unmount()
  })

  it("opens the mobile overlay from the burger (teleported to body)", async () => {
    const wrapper = await mountSuspended(AppHeader)
    expect(document.querySelector("#mobile-nav")).toBeNull()
    await wrapper.find('button[aria-label="Ouvrir le menu"]').trigger("click")
    expect(document.querySelector("#mobile-nav")).not.toBeNull()
    wrapper.unmount()
  })

  it("expands a shop tab's accordion in the mobile menu", async () => {
    const wrapper = await mountSuspended(AppHeader)
    await wrapper.find('button[aria-label="Ouvrir le menu"]').trigger("click")
    const toggle = document.querySelector('button[aria-controls="msub-chasse"]') as HTMLElement | null
    expect(toggle).not.toBeNull()
    expect(toggle?.getAttribute("aria-expanded")).toBe("false")
    toggle?.click()
    await nextTick()
    expect(toggle?.getAttribute("aria-expanded")).toBe("true")
    // The nested entries come from the mocked shop menu.
    expect(document.querySelector("#msub-chasse")?.textContent).toContain("Carabines")
    wrapper.unmount()
  })

  it("shows the brand logo as the home link, named once by the link", async () => {
    const wrapper = await mountSuspended(AppHeader)
    const home = wrapper.find('a.brand[href="/"]')
    expect(home.attributes("aria-label")).toBe("SCS Firearms — accueil")
    expect(home.find("img.logo").attributes("alt")).toBe("")
  })
})
