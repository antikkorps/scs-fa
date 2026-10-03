// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import Livraison from "./livraison.vue"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

const RATES = { firearmParcelTtc: 25, smallParcelTtc: 8.9, smallParcelFreeFromTtc: 150, printTtc: 15 }

beforeEach(() => {
  // The page caches the grid under one useAsyncData key: start every test from the API.
  clearNuxtData("admin-shipping-rates")
  apiMock.mockReset()
  apiMock.mockImplementation((_url: string, options?: { method?: string; body?: unknown }) =>
    Promise.resolve({ data: options?.method === "PUT" ? options.body : RATES }),
  )
})

async function mountPage() {
  const wrapper = await mountSuspended(Livraison)
  await flushPromises()
  return wrapper
}

const inputs = (wrapper: Awaited<ReturnType<typeof mountPage>>) => wrapper.findAll('input[type="number"]')

describe("admin/livraison.vue (story 12.3)", () => {
  it("loads the grid in force into the form", async () => {
    const wrapper = await mountPage()
    const values = inputs(wrapper).map((i) => (i.element as HTMLInputElement).value)
    expect(values).toEqual(["25", "8.9", "150", "15"])
    // 2 firearm parcels + small parcel + print.
    expect(wrapper.find(".example").text()).toMatch(/73,90/)
  })

  it("saves the four amounts together", async () => {
    const wrapper = await mountPage()
    await inputs(wrapper)[0]?.setValue(30)
    await wrapper.find("form").trigger("submit")
    await flushPromises()
    expect(apiMock).toHaveBeenLastCalledWith("/admin/shipping-rates", {
      method: "PUT",
      body: { ...RATES, firearmParcelTtc: 30 },
    })
    expect(wrapper.find('[role="status"]').text()).toBe("Grille enregistrée.")
  })

  it("sends a null threshold when free delivery is switched off", async () => {
    const wrapper = await mountPage()
    await wrapper.find('input[type="checkbox"]').setValue(false)
    expect(inputs(wrapper)).toHaveLength(3)
    await wrapper.find("form").trigger("submit")
    await flushPromises()
    expect(apiMock).toHaveBeenLastCalledWith("/admin/shipping-rates", {
      method: "PUT",
      body: { ...RATES, smallParcelFreeFromTtc: null },
    })
  })

  it("explains a refused grid", async () => {
    const wrapper = await mountPage()
    apiMock.mockRejectedValueOnce({ response: { status: 400 } })
    await wrapper.find("form").trigger("submit")
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain("Montants invalides")
  })
})
