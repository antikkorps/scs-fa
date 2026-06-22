// @vitest-environment nuxt

import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ForgotPassword from "./mot-de-passe-oublie.vue"

const { forgotPassword } = vi.hoisted(() => ({ forgotPassword: vi.fn() }))

mockNuxtImport("useAuth", () => () => ({ forgotPassword }))

beforeEach(() => {
  forgotPassword.mockReset()
})

describe("mot-de-passe-oublie.vue", () => {
  it("shows a neutral anti-enumeration message after a successful request", async () => {
    forgotPassword.mockResolvedValue({})
    const wrapper = await mountSuspended(ForgotPassword)
    await wrapper.find('input[type="email"]').setValue("buyer@example.com")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(forgotPassword).toHaveBeenCalledWith("buyer@example.com")
    expect(wrapper.text()).toContain("Si un compte est associé à cette adresse")
  })

  it("validates the email before calling the API", async () => {
    const wrapper = await mountSuspended(ForgotPassword)
    await wrapper.find('input[type="email"]').setValue("nope")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(forgotPassword).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain("Adresse email invalide.")
  })
})
