// @vitest-environment nuxt

import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import Connexion from "./connexion.vue"

const { login, verifyLoginCode, resendLoginCode, navigateToMock, isAuthenticated } = vi.hoisted(() => ({
  login: vi.fn(),
  verifyLoginCode: vi.fn(),
  resendLoginCode: vi.fn(),
  navigateToMock: vi.fn(),
  isAuthenticated: { value: false },
}))

mockNuxtImport("useAuth", () => () => ({ login, verifyLoginCode, resendLoginCode, isAuthenticated }))
mockNuxtImport("navigateTo", () => navigateToMock)

beforeEach(() => {
  login.mockReset()
  verifyLoginCode.mockReset()
  resendLoginCode.mockReset()
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
    login.mockResolvedValue({ status: "signed_in", user: { role: "customer" } })
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

  describe("code step (story 12.8a)", () => {
    async function passwordAccepted() {
      login.mockResolvedValue({ status: "code_required", expiresIn: 600 })
      const wrapper = await mountSuspended(Connexion)
      await wrapper.find('input[type="email"]').setValue("agent@mairie.fr")
      await wrapper.find('input[type="password"]').setValue("longenoughpass")
      await wrapper.find("form").trigger("submit")
      await flushPromises()
      return wrapper
    }

    async function typeCode(wrapper: Awaited<ReturnType<typeof passwordAccepted>>, code: string) {
      await wrapper.find('input[autocomplete="one-time-code"]').setValue(code)
      await wrapper.find("form").trigger("submit")
      await flushPromises()
    }

    it("asks for the code mailed after the right password, instead of signing in", async () => {
      const wrapper = await passwordAccepted()

      expect(wrapper.find('input[type="password"]').exists()).toBe(false)
      expect(wrapper.find('input[autocomplete="one-time-code"]').exists()).toBe(true)
      expect(wrapper.text()).toContain("agent@mairie.fr")
      expect(navigateToMock).not.toHaveBeenCalled()
    })

    it("signs in and redirects on the right code", async () => {
      verifyLoginCode.mockResolvedValue({ role: "customer" })
      const wrapper = await passwordAccepted()
      await typeCode(wrapper, " 042 917 ")

      expect(verifyLoginCode).toHaveBeenCalledWith("042917")
      expect(navigateToMock).toHaveBeenCalledWith("/")
    })

    it("refuses anything but 6 digits before asking the server", async () => {
      const wrapper = await passwordAccepted()
      await typeCode(wrapper, "12345")

      expect(verifyLoginCode).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain("Le code compte 6 chiffres.")
    })

    it("says how many tries are left on a wrong code", async () => {
      verifyLoginCode.mockRejectedValue({
        response: { status: 401 },
        data: { error: "InvalidLoginCode", remainingAttempts: 3 },
      })
      const wrapper = await passwordAccepted()
      await typeCode(wrapper, "000000")

      expect(wrapper.text()).toContain("Code incorrect. Encore 3 essais.")
    })

    it("goes back to the password once the code can no longer be used", async () => {
      verifyLoginCode.mockRejectedValue({
        response: { status: 401 },
        data: { error: "InvalidLoginCode", remainingAttempts: 0 },
      })
      const wrapper = await passwordAccepted()
      await typeCode(wrapper, "000000")

      expect(wrapper.find('input[type="password"]').exists()).toBe(true)
      expect(wrapper.text()).toContain("Reconnectez-vous")
    })

    it("sends a new code on request, and says so", async () => {
      resendLoginCode.mockResolvedValue(undefined)
      const wrapper = await passwordAccepted()
      await wrapper.find("button.auth-resend").trigger("click")
      await flushPromises()

      expect(resendLoginCode).toHaveBeenCalledTimes(1)
      expect(wrapper.text()).toContain("Un nouveau code vous a été envoyé.")
    })

    it("asks to wait when a new code comes too soon", async () => {
      resendLoginCode.mockRejectedValue({
        response: { status: 429 },
        data: { error: "LoginCodeResendRefused", retryAfterSeconds: 42 },
      })
      const wrapper = await passwordAccepted()
      await wrapper.find("button.auth-resend").trigger("click")
      await flushPromises()

      expect(wrapper.text()).toContain("Patientez encore 42 secondes")
    })
  })
})
