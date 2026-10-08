// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import Fournisseurs from "./fournisseurs.vue"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

const SUPPLIERS = [
  { id: "s1", name: "BGM", contactEmail: "pro@bgm.example", contactPhone: null, products: 120 },
  { id: "s2", name: "Toro", contactEmail: null, contactPhone: null, products: 0 },
]

beforeEach(() => {
  apiMock.mockReset()
  apiMock.mockResolvedValue({ data: SUPPLIERS })
})

async function mountPage() {
  const wrapper = await mountSuspended(Fournisseurs, { route: "/admin/fournisseurs" })
  await flushPromises()
  return wrapper
}

describe("admin/fournisseurs.vue (story 12.5)", () => {
  it("lists the declared suppliers with their product count", async () => {
    const wrapper = await mountPage()
    expect(apiMock).toHaveBeenCalledWith("/admin/suppliers")
    const lines = wrapper.findAll("tbody tr").map((line) => line.text())
    expect(lines[0]).toContain("BGM")
    expect(lines[0]).toContain("120")
    expect(lines[1]).toContain("Toro")
  })

  it("creates a supplier from its name and contact details only", async () => {
    const wrapper = await mountPage()
    await wrapper.find(".btn-add").trigger("click")
    const labels = wrapper.findAll(".form .field__label").map((label) => label.text().replace(" *", ""))
    expect(labels).toEqual(["Nom", "E-mail", "Téléphone"])

    await wrapper.findAll(".form input")[0]?.setValue("Agora-Tec")
    apiMock.mockResolvedValueOnce({ data: {} }).mockResolvedValueOnce({ data: SUPPLIERS })
    await wrapper.find(".btn-primary").trigger("click")
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith("/admin/suppliers", { method: "POST", body: { name: "Agora-Tec" } })
  })

  it("points to the import, where the new supplier's file starts", async () => {
    const wrapper = await mountPage()
    expect(wrapper.find('a[href="/admin/imports"]').exists()).toBe(true)
  })
})
