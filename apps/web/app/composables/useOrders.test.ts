// @vitest-environment nuxt
import { mockNuxtImport } from "@nuxt/test-utils/runtime"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useOrders } from "./useOrders"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))

mockNuxtImport("useApi", () => () => apiMock)

beforeEach(() => {
  apiMock.mockReset()
})

describe("useOrders", () => {
  it("creates an order with the shipping address", async () => {
    apiMock.mockResolvedValue({ data: { id: "ord-1", paymentSplit: { splitType: "carte_only" } } })
    const orders = useOrders()
    const res = await orders.create("addr-1")
    expect(apiMock).toHaveBeenCalledWith("/orders", { method: "POST", body: { shippingAddressId: "addr-1" } })
    expect(res.id).toBe("ord-1")
  })

  it("includes the billing address when provided", async () => {
    apiMock.mockResolvedValue({ data: { id: "ord-2", paymentSplit: {} } })
    const orders = useOrders()
    await orders.create("addr-1", "addr-2")
    expect(apiMock).toHaveBeenCalledWith("/orders", {
      method: "POST",
      body: { shippingAddressId: "addr-1", billingAddressId: "addr-2" },
    })
  })

  it("returns null virement instructions on a 404 (no virement bucket)", async () => {
    apiMock.mockRejectedValue({ response: { status: 404 } })
    const orders = useOrders()
    expect(await orders.getVirement("ord-3")).toBeNull()
  })

  it("returns null when a card-only order has no virement bucket (400 NoBankTransfer)", async () => {
    apiMock.mockRejectedValue({ response: { status: 400 }, data: { error: "NoBankTransfer" } })
    const orders = useOrders()
    expect(await orders.getVirement("ord-cb")).toBeNull()
  })

  it("rethrows other errors from getVirement", async () => {
    apiMock.mockRejectedValue({ response: { status: 500 } })
    const orders = useOrders()
    await expect(orders.getVirement("ord-4")).rejects.toBeTruthy()
  })

  it("claims a transfer via POST .../claim", async () => {
    apiMock.mockResolvedValue({ data: { paymentStatus: "transfer_claimed" } })
    const orders = useOrders()
    const res = await orders.claimVirement("ord-5")
    expect(apiMock).toHaveBeenCalledWith("/payments/virement/ord-5/claim", { method: "POST", body: {} })
    expect(res.paymentStatus).toBe("transfer_claimed")
  })

  it("lists orders with pagination query, returning the paginated envelope", async () => {
    apiMock.mockResolvedValue({ data: [{ id: "ord-1" }], pagination: { page: 2, limit: 20, total: 25 } })
    const orders = useOrders()
    const res = await orders.list(2)
    expect(apiMock).toHaveBeenCalledWith("/orders", { query: { page: 2, limit: 20 } })
    expect(res.data).toHaveLength(1)
    expect(res.pagination.page).toBe(2)
  })

  it("defaults to page 1 when no page is given", async () => {
    apiMock.mockResolvedValue({ data: [], pagination: { page: 1, limit: 20, total: 0 } })
    const orders = useOrders()
    await orders.list()
    expect(apiMock).toHaveBeenCalledWith("/orders", { query: { page: 1, limit: 20 } })
  })
})
