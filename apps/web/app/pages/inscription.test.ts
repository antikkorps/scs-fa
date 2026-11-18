// @vitest-environment nuxt

import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { returnOf } from "../../tests/helpers/links"
import Inscription from "./inscription.vue"

const { register, navigateToMock, isAuthenticated } = vi.hoisted(() => ({
  register: vi.fn(),
  navigateToMock: vi.fn(),
  isAuthenticated: { value: false },
}))

mockNuxtImport("useAuth", () => () => ({ register, isAuthenticated, isAdmin: { value: false } }))
mockNuxtImport("navigateTo", () => navigateToMock)

beforeEach(() => {
  useState("launch").value = { launchStage: "open", indexingEnabled: true, adminPreview: false }
  register.mockReset()
  navigateToMock.mockReset()
  isAuthenticated.value = false
})

async function fillValidForm(wrapper: Awaited<ReturnType<typeof mountSuspended>>) {
  await wrapper.find('input[autocomplete="given-name"]').setValue("Jean")
  await wrapper.find('input[autocomplete="family-name"]').setValue("Dupont")
  await wrapper.find('input[type="email"]').setValue("buyer@example.com")
  await wrapper.find('input[type="password"]').setValue("longenoughpassword")
}

describe("inscription.vue", () => {
  it("requires RGPD consent before submitting", async () => {
    const wrapper = await mountSuspended(Inscription)
    await fillValidForm(wrapper)
    // consent checkbox left unchecked
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(register).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain("Vous devez accepter la politique de confidentialité.")
  })

  // Sign-up without enumeration: the same answer whether the address was free
  // or taken, so no session and no "already exists" — the mailbox tells.
  it("registers, then sends the visitor to the mailbox without signing in", async () => {
    register.mockResolvedValue(undefined)
    const wrapper = await mountSuspended(Inscription)
    await fillValidForm(wrapper)
    await wrapper.find('input[type="checkbox"]').setValue(true)
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(register).toHaveBeenCalledOnce()
    expect(navigateToMock).not.toHaveBeenCalled()
    expect(wrapper.find("form").exists()).toBe(false)
    expect(wrapper.text()).toContain("Vérifiez votre boîte mail")
    expect(wrapper.text()).toContain("buyer@example.com")
    expect(wrapper.find('a[href^="/connexion"]').exists()).toBe(true)
  })

  it("keeps the form and says so when the sign-up fails", async () => {
    register.mockRejectedValue({ response: { status: 500 } })
    const wrapper = await mountSuspended(Inscription)
    await fillValidForm(wrapper)
    await wrapper.find('input[type="checkbox"]').setValue(true)
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(wrapper.text()).toContain("Inscription impossible")
    expect(wrapper.find("form").exists()).toBe(true)
  })

  it("points professionals to their own signup", async () => {
    const wrapper = await mountSuspended(Inscription)
    expect(wrapper.find('a[href="/pro/inscription"]').exists()).toBe(true)
  })
})

describe("inscription.test.ts before the opening (story 12.10)", () => {
  it("replaces the form with the opening notice in the showcase stage", async () => {
    useState("launch").value = { launchStage: "showcase", indexingEnabled: false, adminPreview: false }
    const wrapper = await mountSuspended(Inscription)
    expect(wrapper.find('input[type="password"]').exists()).toBe(false)
    expect(wrapper.text()).toContain("La création de compte ouvre avec la boutique")
  })
})

// UX audit 2026-11-01 (I3): the sign-up used to lose the page the visitor came from.
describe("inscription.vue — coming from the cart", () => {
  const FROM_CART = "/inscription?redirect=%2Fboutique%2Ffusil-x%3Fajouter%3Dv2&motif=panier"

  it("keeps the way back to the product, with the item to add, on the login link once the account is created", async () => {
    register.mockResolvedValue(undefined)
    const wrapper = await mountSuspended(Inscription, { route: FROM_CART })
    await fillValidForm(wrapper)
    await wrapper.find('input[type="checkbox"]').setValue(true)
    await wrapper.find("form").trigger("submit")
    await flushPromises()
    expect(returnOf(wrapper.find('a[href^="/connexion"]').attributes("href"))).toEqual({
      path: "/connexion",
      redirect: "/boutique/fusil-x?ajouter=v2",
      motif: "panier",
    })
  })

  it("says the item will be added, and keeps the way back on the login link", async () => {
    const wrapper = await mountSuspended(Inscription, { route: FROM_CART })
    expect(wrapper.text()).toContain("l'article sera ajouté à votre panier")
    expect(returnOf(wrapper.find('a[href^="/connexion"]').attributes("href"))).toEqual({
      path: "/connexion",
      redirect: "/boutique/fusil-x?ajouter=v2",
      motif: "panier",
    })
  })
})
