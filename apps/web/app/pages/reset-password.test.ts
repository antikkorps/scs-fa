// @vitest-environment nuxt

import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ResetPassword from "./reset-password.vue"

const { resetPassword } = vi.hoisted(() => ({ resetPassword: vi.fn() }))

mockNuxtImport("useAuth", () => () => ({ resetPassword }))

const TOKEN = "a".repeat(32)
const withToken = { route: `/reset-password?token=${TOKEN}` }

beforeEach(() => {
  resetPassword.mockReset()
})

function passwordInputs(wrapper: Awaited<ReturnType<typeof mountSuspended>>) {
  const [password, confirm] = wrapper.findAll('input[type="password"]')
  if (!password || !confirm) throw new Error("Expected two password inputs")
  return { password, confirm }
}

describe("reset-password.vue", () => {
  it("warns when no token is present in the URL", async () => {
    const wrapper = await mountSuspended(ResetPassword, { route: "/reset-password" })
    expect(wrapper.text()).toContain("Lien invalide")
    expect(wrapper.find('input[type="password"]').exists()).toBe(false)
  })

  it("blocks submit when the two passwords differ", async () => {
    const wrapper = await mountSuspended(ResetPassword, withToken)
    const { password, confirm } = passwordInputs(wrapper)
    await password.setValue("longenoughpassword")
    await confirm.setValue("differentpassword1")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(resetPassword).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain("Les mots de passe ne correspondent pas.")
  })

  it("resets the password and confirms success", async () => {
    resetPassword.mockResolvedValue({})
    const wrapper = await mountSuspended(ResetPassword, withToken)
    const { password, confirm } = passwordInputs(wrapper)
    await password.setValue("longenoughpassword")
    await confirm.setValue("longenoughpassword")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(resetPassword).toHaveBeenCalledWith(TOKEN, "longenoughpassword")
    expect(wrapper.text()).toContain("Votre mot de passe a été réinitialisé.")
  })

  it("shows an invalid-link message on a 400", async () => {
    resetPassword.mockRejectedValue({ response: { status: 400 } })
    const wrapper = await mountSuspended(ResetPassword, withToken)
    const { password, confirm } = passwordInputs(wrapper)
    await password.setValue("longenoughpassword")
    await confirm.setValue("longenoughpassword")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(wrapper.text()).toContain("Ce lien est invalide ou a expiré")
  })

  it("tells the user when the new password matches the old one (422)", async () => {
    resetPassword.mockRejectedValue({ response: { status: 422 } })
    const wrapper = await mountSuspended(ResetPassword, withToken)
    const { password, confirm } = passwordInputs(wrapper)
    await password.setValue("longenoughpassword")
    await confirm.setValue("longenoughpassword")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(wrapper.text()).toContain("doit être différent de l'ancien")
  })
})
