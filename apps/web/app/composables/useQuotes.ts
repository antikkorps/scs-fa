import type { QuoteBasket, QuoteRequestDetail, QuoteRequestSummary } from "~/types/quote"

// Story 12.8c — a pro's quote basket and requests. `basketCount` is shared
// app-wide, like the cart's, so the header can show it.
export function useQuotes() {
  const api = useApi()
  const basketCount = useState<number>("quote-basket-count", () => 0)

  function synced(basket: QuoteBasket) {
    basketCount.value = basket.items.length
    return basket
  }

  async function fetchBasket(): Promise<QuoteBasket> {
    return synced((await api<{ data: QuoteBasket }>("/pro/quote-basket")).data)
  }

  async function addToBasket(variantId: string, qty = 1): Promise<QuoteBasket> {
    const res = await api<{ data: QuoteBasket }>("/pro/quote-basket/items", {
      method: "POST",
      body: { variantId, qty },
    })
    return synced(res.data)
  }

  async function updateLine(id: string, qty: number): Promise<QuoteBasket> {
    const res = await api<{ data: QuoteBasket }>(`/pro/quote-basket/items/${id}`, { method: "PATCH", body: { qty } })
    return synced(res.data)
  }

  async function removeLine(id: string): Promise<QuoteBasket> {
    await api(`/pro/quote-basket/items/${id}`, { method: "DELETE" })
    return fetchBasket()
  }

  async function submit(message: string): Promise<QuoteRequestDetail> {
    const res = await api<{ data: QuoteRequestDetail }>("/pro/quote-requests", {
      method: "POST",
      body: message.trim() ? { message } : {},
    })
    basketCount.value = 0
    return res.data
  }

  async function listRequests(): Promise<QuoteRequestSummary[]> {
    return (await api<{ data: QuoteRequestSummary[] }>("/pro/quote-requests")).data
  }

  async function getRequest(id: string): Promise<QuoteRequestDetail> {
    return (await api<{ data: QuoteRequestDetail }>(`/pro/quote-requests/${id}`)).data
  }

  async function cancelRequest(id: string): Promise<QuoteRequestDetail> {
    return (await api<{ data: QuoteRequestDetail }>(`/pro/quote-requests/${id}/cancel`, { method: "POST" })).data
  }

  return {
    basketCount,
    fetchBasket,
    addToBasket,
    updateLine,
    removeLine,
    submit,
    listRequests,
    getRequest,
    cancelRequest,
  }
}
