// @vitest-environment nuxt

import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import Connexion from "./connexion.vue"

const { login, navigateToMock, isAuthenticated } = vi.hoisted(() => ({
  login: vi.fn(),
  navigateToMock: vi.fn(),
  isAuthenticated: { value: false },
}))

mockNuxtImport("useAuth", () => () => ({ login, isAuthenticated }))
mockNuxtImport("navigateTo", () => navigateToMock)

beforeEach(() => {
  login.mockReset()
  navigateToMock.mockReset()
  isAuthenticated.value = false
})

describe("connexion.vue", () => {
  it("blocks submit and shows a field error for an invalid email", async () => {
    const wrapper = await mountSuspended(Connexion)
    await wrapper.find('input[type="email"]').setValue("not-an-email")
    await wrapper.find('input[type="password"]').setValue("anything12345")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(login).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain("Adresse email invalide.")
  })

  it("logs in and redirects home on valid credentials", async () => {
    login.mockResolvedValue({ role: "customer" })
    const wrapper = await mountSuspended(Connexion)
    await wrapper.find('input[type="email"]').setValue("buyer@example.com")
    await wrapper.find('input[type="password"]').setValue("longenoughpass")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(login).toHaveBeenCalledWith("buyer@example.com", "longenoughpass")
    expect(navigateToMock).toHaveBeenCalledWith("/")
  })

  it("shows an invalid-credentials message on a 401", async () => {
    login.mockRejectedValue({ response: { status: 401 } })
    const wrapper = await mountSuspended(Connexion)
    await wrapper.find('input[type="email"]').setValue("buyer@example.com")
    await wrapper.find('input[type="password"]').setValue("longenoughpass")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(wrapper.text()).toContain("Email ou mot de passe invalide.")
    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it("shows a lockout message on a 423", async () => {
    login.mockRejectedValue({ response: { status: 423 } })
    const wrapper = await mountSuspended(Connexion)
    await wrapper.find('input[type="email"]').setValue("buyer@example.com")
    await wrapper.find('input[type="password"]').setValue("longenoughpass")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(wrapper.text()).toContain("Trop de tentatives")
  })
})
