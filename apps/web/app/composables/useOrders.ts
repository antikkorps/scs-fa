import type { ClaimVirementInput } from "@armurier/shared"
import type { OrderSummary, Paginated } from "~/types/account"
import type { CreatedOrder, OrderDetail, VirementInstructions } from "~/types/checkout"

// Authenticated order + payment operations for the checkout tunnel and account area.
export function useOrders() {
  const api = useApi()

  function create(shippingAddressId: string, billingAddressId?: string): Promise<CreatedOrder> {
    return api<{ data: CreatedOrder }>("/orders", {
      method: "POST",
      body: { shippingAddressId, ...(billingAddressId ? { billingAddressId } : {}) },
    }).then((r) => r.data)
  }

  // The authenticated user's orders, newest first (account area).
  function list(page = 1, limit = 20): Promise<Paginated<OrderSummary>> {
    return api<Paginated<OrderSummary>>("/orders", { query: { page, limit } })
  }

  function get(id: string): Promise<OrderDetail> {
    return api<{ data: OrderDetail }>(`/orders/${id}`).then((r) => r.data)
  }

  // Bank-transfer (RIB) instructions for the order's virement bucket, or null
  // when the order has no virement portion: the API answers 404 (unknown order)
  // or 400 "NoBankTransfer" for a card-only order.
  async function getVirement(orderId: string): Promise<VirementInstructions | null> {
    try {
      const res = await api<{ data: VirementInstructions }>(`/payments/virement/${orderId}`)
      return res.data
    } catch (err) {
      const status = authErrorStatus(err)
      const code = (err as { data?: { error?: string } })?.data?.error
      if (status === 404 || (status === 400 && code === "NoBankTransfer")) return null
      throw err
    }
  }

  function claimVirement(orderId: string, input: ClaimVirementInput = {}): Promise<VirementInstructions> {
    return api<{ data: VirementInstructions }>(`/payments/virement/${orderId}/claim`, {
      method: "POST",
      body: input,
    }).then((r) => r.data)
  }

  // Creates/reuses the order's card PaymentIntent and returns its client secret
  // for Stripe Elements.
  function createStripeIntent(
    orderId: string,
  ): Promise<{ clientSecret: string; paymentIntentId: string; amountTtc: string }> {
    return api<{ data: { clientSecret: string; paymentIntentId: string; amountTtc: string } }>(
      "/payments/stripe/intent",
      { method: "POST", body: { orderId } },
    ).then((r) => r.data)
  }

  return { create, list, get, getVirement, claimVirement, createStripeIntent }
}
