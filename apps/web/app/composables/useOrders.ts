import type { ClaimVirementInput } from "@armurier/shared"
import type { CreatedOrder, OrderDetail, VirementInstructions } from "~/types/checkout"

// Authenticated order + payment operations for the checkout tunnel.
export function useOrders() {
  const api = useApi()

  function create(shippingAddressId: string, billingAddressId?: string): Promise<CreatedOrder> {
    return api<{ data: CreatedOrder }>("/orders", {
      method: "POST",
      body: { shippingAddressId, ...(billingAddressId ? { billingAddressId } : {}) },
    }).then((r) => r.data)
  }

  function get(id: string): Promise<OrderDetail> {
    return api<{ data: OrderDetail }>(`/orders/${id}`).then((r) => r.data)
  }

  // Bank-transfer (RIB) instructions for the order's virement bucket, or null
  // when the order has no virement portion (404 from the API).
  async function getVirement(orderId: string): Promise<VirementInstructions | null> {
    try {
      const res = await api<{ data: VirementInstructions }>(`/payments/virement/${orderId}`)
      return res.data
    } catch (err) {
      if (authErrorStatus(err) === 404) return null
      throw err
    }
  }

  function claimVirement(orderId: string, input: ClaimVirementInput = {}): Promise<VirementInstructions> {
    return api<{ data: VirementInstructions }>(`/payments/virement/${orderId}/claim`, {
      method: "POST",
      body: input,
    }).then((r) => r.data)
  }

  return { create, get, getVirement, claimVirement }
}
