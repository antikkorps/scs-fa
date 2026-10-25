// @vitest-environment nuxt
import { mockNuxtImport } from "@nuxt/test-utils/runtime"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useQuotes } from "./useQuotes"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

const BASKET = {
  items: [
    { id: "l1", qty: 2 },
    { id: "l2", qty: 1 },
  ],
}

beforeEach(() => {
  apiMock.mockReset()
  apiMock.mockResolvedValue({ data: BASKET })
})

describe("useQuotes (story 12.8c)", () => {
  it("fills the basket and keeps its line count for the header", async () => {
    const quotes = useQuotes()
    await quotes.addToBasket("v1", 2)
    expect(apiMock).toHaveBeenCalledWith("/pro/quote-basket/items", {
      method: "POST",
      body: { variantId: "v1", qty: 2 },
    })
    expect(quotes.basketCount.value).toBe(2)
  })

  it("changes and removes basket lines", async () => {
    const quotes = useQuotes()
    await quotes.updateLine("l1", 5)
    expect(apiMock).toHaveBeenCalledWith("/pro/quote-basket/items/l1", { method: "PATCH", body: { qty: 5 } })

    apiMock.mockResolvedValueOnce(null).mockResolvedValueOnce({ data: { items: [] } })
    await quotes.removeLine("l1")
    expect(apiMock).toHaveBeenCalledWith("/pro/quote-basket/items/l1", { method: "DELETE" })
    expect(quotes.basketCount.value).toBe(0)
  })

  it("sends the basket as a request, which empties it", async () => {
    apiMock.mockResolvedValueOnce({ data: { id: "r1", number: "DR-2026-0001" } })
    const quotes = useQuotes()
    quotes.basketCount.value = 3

    const request = await quotes.submit("Livraison au poste")

    expect(apiMock).toHaveBeenCalledWith("/pro/quote-requests", {
      method: "POST",
      body: { message: "Livraison au poste" },
    })
    expect(request.number).toBe("DR-2026-0001")
    expect(quotes.basketCount.value).toBe(0)
  })

  it("lists, opens and cancels requests", async () => {
    const quotes = useQuotes()
    await quotes.listRequests()
    expect(apiMock).toHaveBeenCalledWith("/pro/quote-requests")
    await quotes.getRequest("r1")
    expect(apiMock).toHaveBeenCalledWith("/pro/quote-requests/r1")
    await quotes.cancelRequest("r1")
    expect(apiMock).toHaveBeenCalledWith("/pro/quote-requests/r1/cancel", { method: "POST" })
  })

  // Story 12.8d-2 — accepting a quote places its order.
  it("accepts a quote with the delivery address, the terms and the Chorus Pro references", async () => {
    apiMock.mockResolvedValueOnce({ data: { id: "o1", totalTtc: 1365.6 } })
    const quotes = useQuotes()
    const body = {
      shippingAddressId: "a1",
      acceptedTermsVersion: "2026-10-22",
      chorusServiceCode: "SRV-42",
      chorusCommitmentNumber: "",
    }

    const order = await quotes.acceptQuote("r1", body)

    expect(apiMock).toHaveBeenCalledWith("/pro/quote-requests/r1/accept", { method: "POST", body })
    expect(order.id).toBe("o1")
  })
})
