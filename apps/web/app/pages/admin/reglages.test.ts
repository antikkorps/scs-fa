// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import Reglages from "./reglages.vue"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

beforeEach(() => {
  clearNuxtData("admin-shop-settings")
  apiMock.mockReset()
  apiMock.mockImplementation((_url: string, options?: { method?: string; body?: unknown }) =>
    Promise.resolve({ data: options?.method === "PUT" ? options.body : { vipMarginSharePct: 50 } }),
  )
})

async function mountPage() {
  const wrapper = await mountSuspended(Reglages)
  await flushPromises()
  return wrapper
}

describe("admin/reglages.vue (story 12.9e)", () => {
  it("loads the VIP share in force, with a worked example", async () => {
    const wrapper = await mountPage()
    expect((wrapper.find('input[type="number"]').element as HTMLInputElement).value).toBe("50")
    // 1 000 € HT at 30 % margin, half of it back → 15 % → 150 € HT.
    expect(wrapper.find(".example").text()).toMatch(/150,00/)
  })

  it("saves the new share", async () => {
    const wrapper = await mountPage()
    await wrapper.find('input[type="number"]').setValue(40)
    await wrapper.find("form").trigger("submit")
    await flushPromises()
    expect(apiMock).toHaveBeenLastCalledWith("/admin/shop-settings", {
      method: "PUT",
      body: { vipMarginSharePct: 40 },
    })
    expect(wrapper.find('[role="status"]').text()).toBe("Réglages enregistrés.")
    expect(wrapper.find(".example").text()).toMatch(/120,00/)
  })

  it("explains a refused value", async () => {
    const wrapper = await mountPage()
    apiMock.mockRejectedValueOnce({ response: { status: 400 } })
    await wrapper.find("form").trigger("submit")
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain("entre 0 et 100")
  })
})
