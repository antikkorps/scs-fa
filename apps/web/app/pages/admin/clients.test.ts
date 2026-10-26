// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AdminUserRow } from "~/types/admin"
import Clients from "./clients.vue"

const { apiMock, confirmMock } = vi.hoisted(() => ({ apiMock: vi.fn(), confirmMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

const JEANNE: AdminUserRow = {
  id: "u1",
  email: "jeanne@example.fr",
  firstname: "Jeanne",
  lastname: "Armand",
  role: "customer",
  isPro: false,
  totpEnabled: true,
  createdAt: "2026-10-21T10:00:00Z",
}
const PAUL: AdminUserRow = { ...JEANNE, id: "u2", email: "paul@example.fr", firstname: "Paul", totpEnabled: false }

async function searchFor(text: string) {
  const wrapper = await mountSuspended(Clients, { route: "/admin/clients" })
  await wrapper.find("input[type=search]").setValue(text)
  await wrapper.find("form").trigger("submit")
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  apiMock.mockReset()
  apiMock.mockImplementation(async () => ({ data: [{ ...JEANNE }, { ...PAUL }] }))
  confirmMock.mockReset().mockReturnValue(true)
  vi.stubGlobal("confirm", confirmMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("admin/clients.vue — find a customer, reset their authenticator app", () => {
  it("lists nothing before a search, and asks for three characters", async () => {
    const wrapper = await searchFor("je")
    expect(apiMock).not.toHaveBeenCalledWith(expect.stringContaining("/admin/users"))
    expect(wrapper.text()).toContain("3 caractères")
  })

  it("searches the accounts and shows who has the app", async () => {
    const wrapper = await searchFor("  armand ")
    expect(apiMock).toHaveBeenCalledWith("/admin/users?q=armand")
    const lines = wrapper.findAll("tbody tr").map((line) => line.text())
    expect(lines[0]).toContain("Jeanne Armand")
    expect(lines[0]).toContain("jeanne@example.fr")
    expect(lines[0]).toContain("Activée")
    expect(lines[1]).toContain("Désactivée")
    expect(wrapper.findAll("tbody tr")[1]?.find(".reset-totp").exists()).toBe(false)
  })

  it("resets the app after confirmation, and the row follows", async () => {
    const wrapper = await searchFor("armand")
    apiMock.mockResolvedValueOnce({ data: { enabled: false } })
    await wrapper.find(".reset-totp").trigger("click")
    await flushPromises()
    expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining("jeanne@example.fr"))
    expect(apiMock).toHaveBeenCalledWith("/admin/users/u1/totp/reset", { method: "POST" })
    expect(wrapper.find("tbody tr").text()).toContain("Désactivée")
    expect(wrapper.find("[role=status]").text()).toContain("jeanne@example.fr")
  })

  it("does nothing when the admin cancels", async () => {
    confirmMock.mockReturnValue(false)
    const wrapper = await searchFor("armand")
    await wrapper.find(".reset-totp").trigger("click")
    await flushPromises()
    expect(apiMock).not.toHaveBeenCalledWith(expect.stringContaining("/totp/reset"), expect.anything())
  })

  it("explains that an admin's own app goes through another admin", async () => {
    const wrapper = await searchFor("armand")
    apiMock.mockRejectedValueOnce({ data: { error: "OwnAccount" } })
    await wrapper.find(".reset-totp").trigger("click")
    await flushPromises()
    expect(wrapper.find("[role=alert]").text()).toContain("autre administrateur")
  })

  it("says so when nobody matches", async () => {
    apiMock.mockImplementation(async () => ({ data: [] }))
    const wrapper = await searchFor("personne")
    expect(wrapper.text()).toContain("Aucun compte")
  })
})
