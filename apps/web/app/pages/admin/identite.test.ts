// @vitest-environment nuxt
import { EMPTY_SHOP_IDENTITY } from "@armurier/shared"
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import Identite from "./identite.vue"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

const STORED = { ...EMPTY_SHOP_IDENTITY, companyName: "SCS Firearms", phone: "04 78 00 00 00" }

beforeEach(() => {
  clearNuxtData("admin-shop-identity")
  apiMock.mockReset()
  apiMock.mockImplementation((_url: string, options?: { method?: string; body?: unknown }) =>
    Promise.resolve({ data: options?.method === "PUT" ? options.body : STORED }),
  )
})

async function mountPage() {
  const wrapper = await mountSuspended(Identite)
  await flushPromises()
  return wrapper
}

describe("admin/identite.vue (audit 2026-11-01, I8)", () => {
  it("loads the record, with every field labelled", async () => {
    const wrapper = await mountPage()
    expect((wrapper.find("input[name='companyName']").element as HTMLInputElement).value).toBe("SCS Firearms")
    expect(wrapper.findAll("input, textarea")).toHaveLength(16)
    for (const field of wrapper.findAll("input, textarea")) {
      expect(field.element.closest("label")?.textContent?.trim()).not.toBe("")
    }
  })

  it("says how many legal facts are still missing, since the legal pages wait for them", async () => {
    const wrapper = await mountPage()
    expect(wrapper.find(".missing").text()).toMatch(/12 informations légales manquent/)
  })

  it("saves the whole record, a blank field sent as missing", async () => {
    const wrapper = await mountPage()
    await wrapper.find("input[name='email']").setValue("contact@scs-firearms.fr")
    await wrapper.find("input[name='phone']").setValue("  ")
    await wrapper.find("form").trigger("submit")
    await flushPromises()
    const [url, options] = apiMock.mock.calls.at(-1) ?? []
    expect(url).toBe("/admin/shop-identity")
    expect(options.method).toBe("PUT")
    expect(Object.keys(options.body)).toHaveLength(16)
    expect(options.body).toMatchObject({ email: "contact@scs-firearms.fr", phone: null, companyName: "SCS Firearms" })
    expect(wrapper.find("[role='status']").text()).toMatch(/Enregistré/)
  })

  it("shows what the API refused", async () => {
    apiMock.mockImplementation((_url: string, options?: { method?: string }) =>
      options?.method === "PUT"
        ? Promise.reject(
            Object.assign(new Error("400"), {
              data: { error: "ValidationError", issues: [{ path: "siret", message: "x" }] },
            }),
          )
        : Promise.resolve({ data: STORED }),
    )
    const wrapper = await mountPage()
    await wrapper.find("form").trigger("submit")
    await flushPromises()
    expect(wrapper.find("[role='alert']").text()).toMatch(/SIRET/)
  })
})
