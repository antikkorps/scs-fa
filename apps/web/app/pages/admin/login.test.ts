// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import Login from "./login.vue"

const { login, verifyLoginCode, resendLoginCode, navigateToMock, isAdmin } = vi.hoisted(() => ({
  login: vi.fn(),
  verifyLoginCode: vi.fn(),
  resendLoginCode: vi.fn(),
  navigateToMock: vi.fn(),
  isAdmin: { value: false },
}))
mockNuxtImport("useAuth", () => () => ({ login, verifyLoginCode, resendLoginCode, isAdmin }))
mockNuxtImport("navigateTo", () => navigateToMock)

beforeEach(() => {
  for (const fn of [login, verifyLoginCode, resendLoginCode, navigateToMock]) fn.mockReset()
})

async function signIn() {
  const wrapper = await mountSuspended(Login, { route: "/admin/login" })
  await wrapper.find('input[type="email"]').setValue("admin@scs.fr")
  await wrapper.find('input[type="password"]').setValue("longenoughpass")
  await wrapper.find("form").trigger("submit")
  await flushPromises()
  return wrapper
}

describe("admin/login.vue (story 12.8e)", () => {
  it("asks an admin for the app's code, then opens the back-office", async () => {
    login.mockResolvedValue({ status: "code_required", method: "totp", expiresIn: 600 })
    verifyLoginCode.mockResolvedValue({ user: { role: "admin" } })
    const wrapper = await signIn()

    await wrapper.find('input[autocomplete="one-time-code"]').setValue("123456")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(verifyLoginCode).toHaveBeenCalledWith("123456")
    expect(navigateToMock).toHaveBeenCalledWith("/admin")
  })

  it("has a new admin enrol the app before entering", async () => {
    login.mockResolvedValue({
      status: "code_required",
      method: "totp_enrollment",
      expiresIn: 600,
      enrollment: { secret: "JBSWY3DPEHPK3PXP", otpauthUri: "otpauth://totp/x", qrSvg: "<svg></svg>" },
    })
    const wrapper = await signIn()
    expect(wrapper.find("img.qr").exists()).toBe(true)
  })

  it("refuses an account that is not an admin", async () => {
    login.mockResolvedValue({ status: "signed_in", user: { role: "customer" } })
    const wrapper = await signIn()
    expect(wrapper.text()).toContain("n'a pas accès à l'administration")
    expect(navigateToMock).not.toHaveBeenCalled()
  })
})
