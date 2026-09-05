// @vitest-environment nuxt
import { mockNuxtImport } from "@nuxt/test-utils/runtime"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useApi } from "./useApi"

const { requestMock, navigateToMock, routeRef } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  navigateToMock: vi.fn(),
  routeRef: { value: { fullPath: "/compte" } },
}))

mockNuxtImport("useRequestFetch", () => () => requestMock)
mockNuxtImport("useRoute", () => () => routeRef.value)
mockNuxtImport("navigateTo", () => navigateToMock)

beforeEach(() => {
  requestMock.mockReset()
  navigateToMock.mockReset()
  routeRef.value = { fullPath: "/compte" }
})

describe("useApi — BFF proxy", () => {
  it("proxies through /bff/api and returns the data", async () => {
    requestMock.mockResolvedValueOnce({ ok: 1 })
    const res = await useApi()("/orders")
    expect(res).toEqual({ ok: 1 })
    expect(requestMock).toHaveBeenCalledWith("/bff/api/orders", undefined)
  })

  it("normalises a path without a leading slash", async () => {
    requestMock.mockResolvedValueOnce({})
    await useApi()("orders")
    expect(requestMock).toHaveBeenCalledWith("/bff/api/orders", undefined)
  })

  it("redirects to /connexion on a 401 in the storefront", async () => {
    requestMock.mockRejectedValue({ response: { status: 401 } })
    await expect(useApi()("/x")).rejects.toBeTruthy()
    expect(navigateToMock).toHaveBeenCalledWith(expect.stringContaining("/connexion"))
  })

  it("redirects to /admin/login on a 401 in the admin area", async () => {
    routeRef.value = { fullPath: "/admin/orders" }
    requestMock.mockRejectedValue({ response: { status: 401 } })
    await expect(useApi()("/x")).rejects.toBeTruthy()
    expect(navigateToMock).toHaveBeenCalledWith(expect.stringContaining("/admin/login"))
  })

  it("rethrows non-401 errors without redirecting", async () => {
    requestMock.mockRejectedValue({ response: { status: 500 } })
    await expect(useApi()("/x")).rejects.toBeTruthy()
    expect(navigateToMock).not.toHaveBeenCalled()
  })
})
