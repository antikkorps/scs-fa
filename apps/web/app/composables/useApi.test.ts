// @vitest-environment nuxt
import { mockNuxtImport } from "@nuxt/test-utils/runtime"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useApi } from "./useApi"

const { refresh, navigateToMock, token, routeRef } = vi.hoisted(() => ({
  refresh: vi.fn(),
  navigateToMock: vi.fn(),
  token: { value: "tok" as string | null },
  routeRef: { value: { fullPath: "/compte" } },
}))

mockNuxtImport("useAuth", () => () => ({ token, refresh }))
mockNuxtImport("useRoute", () => () => routeRef.value)
mockNuxtImport("navigateTo", () => navigateToMock)

const baseMock = vi.fn()

beforeEach(() => {
  refresh.mockReset()
  navigateToMock.mockReset()
  baseMock.mockReset()
  token.value = "tok"
  routeRef.value = { fullPath: "/compte" }
  // Replace $fetch with a stub whose .create() returns our controllable base.
  const fetchStub = vi.fn() as unknown as { create: () => unknown }
  fetchStub.create = vi.fn(() => baseMock)
  vi.stubGlobal("$fetch", fetchStub)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("useApi — 401 handling", () => {
  it("returns data and never refreshes on success", async () => {
    baseMock.mockResolvedValueOnce({ ok: 1 })
    const res = await useApi()("/x")
    expect(res).toEqual({ ok: 1 })
    expect(refresh).not.toHaveBeenCalled()
  })

  it("refreshes once and replays the request on a 401", async () => {
    baseMock.mockRejectedValueOnce({ response: { status: 401 } }).mockResolvedValueOnce({ ok: 2 })
    refresh.mockResolvedValue("newtok")
    const res = await useApi()("/x")
    expect(res).toEqual({ ok: 2 })
    expect(refresh).toHaveBeenCalledOnce()
    expect(baseMock).toHaveBeenCalledTimes(2)
  })

  it("redirects to /connexion when refresh fails on the storefront", async () => {
    baseMock.mockRejectedValue({ response: { status: 401 } })
    refresh.mockResolvedValue(null)
    await expect(useApi()("/x")).rejects.toBeTruthy()
    expect(navigateToMock).toHaveBeenCalledWith(expect.stringContaining("/connexion"))
  })

  it("redirects to /admin/login when refresh fails in the admin area", async () => {
    routeRef.value = { fullPath: "/admin/orders" }
    baseMock.mockRejectedValue({ response: { status: 401 } })
    refresh.mockResolvedValue(null)
    await expect(useApi()("/x")).rejects.toBeTruthy()
    expect(navigateToMock).toHaveBeenCalledWith(expect.stringContaining("/admin/login"))
  })

  it("rethrows non-401 errors without refreshing", async () => {
    baseMock.mockRejectedValue({ response: { status: 500 } })
    await expect(useApi()("/x")).rejects.toBeTruthy()
    expect(refresh).not.toHaveBeenCalled()
  })
})
