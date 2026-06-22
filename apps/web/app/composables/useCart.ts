import type { CartView } from "~/types/cart"

// Authenticated cart operations (all routes require a session — see useApi's
// bearer + refresh handling). `count` is shared app-wide so the header can show
// a badge; call refresh() / the mutations to keep it in sync.
export function useCart() {
  const api = useApi()
  const count = useState<number>("cart-count", () => 0)

  function syncCount(cart: CartView) {
    count.value = cart.summary.itemCount
    return cart
  }

  async function fetchCart(): Promise<CartView> {
    const res = await api<{ data: CartView }>("/cart")
    return syncCount(res.data)
  }

  async function addVariant(variantId: string, qty = 1): Promise<CartView> {
    const res = await api<{ data: CartView }>("/cart/items", { method: "POST", body: { variantId, qty } })
    return syncCount(res.data)
  }

  async function addPrint(printId: string): Promise<CartView> {
    const res = await api<{ data: CartView }>("/cart/items", { method: "POST", body: { printId } })
    return syncCount(res.data)
  }

  async function updateItem(id: string, qty: number): Promise<CartView> {
    const res = await api<{ data: CartView }>(`/cart/items/${id}`, { method: "PATCH", body: { qty } })
    return syncCount(res.data)
  }

  async function removeItem(id: string): Promise<CartView> {
    const res = await api<{ data: CartView }>(`/cart/items/${id}`, { method: "DELETE" })
    return syncCount(res.data)
  }

  async function removeArtworkItem(id: string): Promise<CartView> {
    const res = await api<{ data: CartView }>(`/cart/artwork-items/${id}`, { method: "DELETE" })
    return syncCount(res.data)
  }

  return { count, fetchCart, addVariant, addPrint, updateItem, removeItem, removeArtworkItem }
}
