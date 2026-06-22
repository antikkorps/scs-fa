// @vitest-environment nuxt
import { mockNuxtImport } from "@nuxt/test-utils/runtime"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useCart } from "./useCart"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))

mockNuxtImport("useApi", () => () => apiMock)

beforeEach(() => {
  apiMock.mockReset()
})

const cartWith = (itemCount: number) => ({ data: { summary: { itemCount } } })

describe("useCart", () => {
  it("fetches the cart and syncs the shared count", async () => {
    apiMock.mockResolvedValue(cartWith(3))
    const cart = useCart()
    await cart.fetchCart()
    expect(apiMock).toHaveBeenCalledWith("/cart")
    expect(cart.count.value).toBe(3)
  })

  it("adds a variant with the right body and updates the count", async () => {
    apiMock.mockResolvedValue(cartWith(4))
    const cart = useCart()
    await cart.addVariant("variant-1", 2)
    expect(apiMock).toHaveBeenCalledWith("/cart/items", { method: "POST", body: { variantId: "variant-1", qty: 2 } })
    expect(cart.count.value).toBe(4)
  })

  it("removes a line via DELETE", async () => {
    apiMock.mockResolvedValue(cartWith(0))
    const cart = useCart()
    await cart.removeItem("line-9")
    expect(apiMock).toHaveBeenCalledWith("/cart/items/line-9", { method: "DELETE" })
    expect(cart.count.value).toBe(0)
  })
})
