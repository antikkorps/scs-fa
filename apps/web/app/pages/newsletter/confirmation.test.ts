// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import Confirmation from "./confirmation.vue"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

const TOKEN = "c".repeat(32)

beforeEach(() => {
  apiMock.mockReset()
})

describe("newsletter/confirmation.vue", () => {
  // Story 12.9g — the mailed link carries its token in the fragment.
  it("confirms with the token of the link's fragment", async () => {
    apiMock.mockResolvedValueOnce({ data: { segments: ["armurerie"], unsubscribeToken: "u".repeat(32) } })
    const wrapper = await mountSuspended(Confirmation, { route: `/newsletter/confirmation#token=${TOKEN}` })
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith("/newsletter/confirm", { method: "POST", body: { token: TOKEN } })
    expect(wrapper.text()).toContain("C'est confirmé")
    expect(window.location.hash).not.toContain(TOKEN)
  })

  it("ignores a token in the query string", async () => {
    const wrapper = await mountSuspended(Confirmation, { route: `/newsletter/confirmation?token=${TOKEN}` })
    await flushPromises()

    expect(apiMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain("Ce lien est invalide")
  })
})
