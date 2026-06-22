// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"
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

beforeEach(() => {
  isAuthenticated.value = false
  isAdmin.value = false
  cartCount.value = 0
})

describe("AppHeader", () => {
  it("renders the two universes and journal in the spine", async () => {
    const wrapper = await mountSuspended(AppHeader)
    const links = wrapper.findAll(".nav__link").map((l) => l.text())
    expect(links).toContain("Armurerie")
    expect(links).toContain("Gun Art")
    expect(links).toContain("Journal")
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
})
