// @vitest-environment nuxt

import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import Inscription from "./inscription.vue"

const { register, navigateToMock, isAuthenticated } = vi.hoisted(() => ({
  register: vi.fn(),
  navigateToMock: vi.fn(),
  isAuthenticated: { value: false },
}))

mockNuxtImport("useAuth", () => () => ({ register, isAuthenticated }))
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

  it("registers and redirects when the form is valid", async () => {
    register.mockResolvedValue({ role: "customer" })
    const wrapper = await mountSuspended(Inscription)
    await fillValidForm(wrapper)
    await wrapper.find('input[type="checkbox"]').setValue(true)
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(register).toHaveBeenCalledOnce()
    expect(navigateToMock).toHaveBeenCalledWith("/")
  })

  it("surfaces a friendly message when the email already exists (409)", async () => {
    register.mockRejectedValue({ response: { status: 409 } })
    const wrapper = await mountSuspended(Inscription)
    await fillValidForm(wrapper)
    await wrapper.find('input[type="checkbox"]').setValue(true)
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(wrapper.text()).toContain("Un compte existe déjà")
    expect(navigateToMock).not.toHaveBeenCalled()
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
