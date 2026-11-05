// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import AdminTotpResetConfirm from "./AdminTotpResetConfirm.vue"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

async function mountConfirm() {
  return mountSuspended(AdminTotpResetConfirm, { props: { userId: "u1", email: "jeanne@example.fr" } })
}

async function fillAndSubmit(wrapper: Awaited<ReturnType<typeof mountConfirm>>, password: string, code: string) {
  await wrapper.find("input[type=password]").setValue(password)
  await wrapper.find("input[autocomplete=one-time-code]").setValue(code)
  await wrapper.find("form").trigger("submit")
  await flushPromises()
}

beforeEach(() => {
  apiMock.mockReset().mockResolvedValue({ data: { enabled: false } })
})

// Review 2026-11-04: resetting someone's second factor asks the admin's own
// password and code, so a stolen admin session alone is not enough.
describe("AdminTotpResetConfirm — the admin confirms who they are first", () => {
  it("names the account and asks for the admin's password and code", async () => {
    const wrapper = await mountConfirm()
    expect(wrapper.text()).toContain("jeanne@example.fr")
    expect(wrapper.find("input[type=password]").attributes("required")).toBeDefined()
    expect(wrapper.find("input[autocomplete=one-time-code]").attributes("required")).toBeDefined()
  })

  it("sends the confirmation with the reset, then says it is done", async () => {
    const wrapper = await mountConfirm()
    await fillAndSubmit(wrapper, "MonMotDePasse", " 123 456 ")
    expect(apiMock).toHaveBeenCalledWith("/admin/users/u1/totp/reset", {
      method: "POST",
      body: { password: "MonMotDePasse", code: "123 456" },
    })
    expect(wrapper.emitted("done")).toHaveLength(1)
  })

  it("says what is wrong when the API refuses, and stays open", async () => {
    const wrapper = await mountConfirm()
    apiMock.mockRejectedValueOnce({ data: { error: "InvalidCredentials" } })
    await fillAndSubmit(wrapper, "faux", "123456")
    expect(wrapper.find("[role=alert]").text()).toContain("Mot de passe incorrect")
    expect(wrapper.emitted("done")).toBeUndefined()

    apiMock.mockRejectedValueOnce({ data: { error: "OwnAccount" } })
    await fillAndSubmit(wrapper, "MonMotDePasse", "123456")
    expect(wrapper.find("[role=alert]").text()).toContain("autre administrateur")
  })

  it("cancels without calling the API", async () => {
    const wrapper = await mountConfirm()
    await wrapper.find("button.cancel").trigger("click")
    expect(wrapper.emitted("cancel")).toHaveLength(1)
    expect(apiMock).not.toHaveBeenCalled()
  })
})
