// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import AccountSecurity from "./AccountSecurity.vue"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

const status = (overrides: Record<string, unknown> = {}) => ({
  enabled: false,
  enabledAt: null,
  required: false,
  recoveryCodesLeft: 0,
  ...overrides,
})

function serve(current: Record<string, unknown>, answers: Record<string, unknown> = {}) {
  apiMock.mockImplementation(async (url: string) => {
    if (url === "/auth/totp") return { data: current }
    for (const [suffix, data] of Object.entries(answers)) if (url.endsWith(suffix)) return { data }
    return { data: {} }
  })
}

const callTo = (suffix: string) => apiMock.mock.calls.find(([url]) => String(url).endsWith(suffix))

beforeEach(() => {
  apiMock.mockReset()
})

describe("AccountSecurity (story 12.8e)", () => {
  it("sets the app up: QR code, a first code, then the recovery codes", async () => {
    serve(status(), {
      "/totp/setup": { secret: "JBSWY3DPEHPK3PXP", otpauthUri: "otpauth://totp/x", qrSvg: "<svg></svg>" },
      "/totp/enable": { recoveryCodes: ["AAAAA-BBBBB", "CCCCC-DDDDD"] },
    })
    const wrapper = await mountSuspended(AccountSecurity)
    await flushPromises()
    expect(wrapper.text()).toMatch(/désactivée/i)

    await wrapper.find("button.setup").trigger("click")
    await flushPromises()
    expect(wrapper.find("img.qr").exists()).toBe(true)
    expect(wrapper.text()).toContain("JBSWY3DPEHPK3PXP")

    await wrapper.find("input[name='totp-code']").setValue("123456")
    await wrapper.find("form.enable").trigger("submit")
    await flushPromises()
    expect(callTo("/totp/enable")?.[1]).toEqual({ method: "POST", body: { code: "123456" } })
    expect(wrapper.text()).toContain("AAAAA-BBBBB")
  })

  it("regenerates the recovery codes against a code", async () => {
    serve(status({ enabled: true, enabledAt: "2026-10-25T10:00:00Z", recoveryCodesLeft: 4 }), {
      "/totp/recovery-codes": { recoveryCodes: ["EEEEE-FFFFF"] },
    })
    const wrapper = await mountSuspended(AccountSecurity)
    await flushPromises()
    expect(wrapper.text()).toContain("4 codes de secours")

    await wrapper.find("input[name='regen-code']").setValue("654321")
    await wrapper.find("form.regenerate").trigger("submit")
    await flushPromises()
    expect(callTo("/totp/recovery-codes")?.[1]).toEqual({ method: "POST", body: { code: "654321" } })
    expect(wrapper.text()).toContain("EEEEE-FFFFF")
  })

  it("turns the app off with the password and a code", async () => {
    serve(status({ enabled: true, enabledAt: "2026-10-25T10:00:00Z", recoveryCodesLeft: 10 }), {
      "/totp/disable": { enabled: false },
    })
    const wrapper = await mountSuspended(AccountSecurity)
    await flushPromises()

    await wrapper.find("input[name='disable-password']").setValue("MotDePasse123!")
    await wrapper.find("input[name='disable-code']").setValue("111111")
    await wrapper.find("form.disable").trigger("submit")
    await flushPromises()
    expect(callTo("/totp/disable")?.[1]).toEqual({
      method: "POST",
      body: { password: "MotDePasse123!", code: "111111" },
    })
  })

  it("never offers an admin to turn it off: it is mandatory", async () => {
    serve(status({ enabled: true, enabledAt: "2026-10-25T10:00:00Z", required: true, recoveryCodesLeft: 10 }))
    const wrapper = await mountSuspended(AccountSecurity)
    await flushPromises()
    expect(wrapper.text()).toContain("obligatoire")
    expect(wrapper.find("form.disable").exists()).toBe(false)
  })
})
