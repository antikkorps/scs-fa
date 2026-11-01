// @vitest-environment nuxt
import { mockNuxtImport } from "@nuxt/test-utils/runtime"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useCart } from "./useCart"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

beforeEach(() => {
  apiMock.mockReset().mockResolvedValue({ data: { summary: { itemCount: 1 } } })
})

describe("useCart", () => {
  it("adds a print as a single copy: the API requires a quantity (UX audit 2026-11-01)", async () => {
    await useCart().addPrint("print-1")
    expect(apiMock).toHaveBeenCalledWith("/cart/items", { method: "POST", body: { printId: "print-1", qty: 1 } })
  })
})
