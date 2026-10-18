// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { OrderHistoryEvent } from "~/utils/history"
import AdminOrderHistory from "./AdminOrderHistory.vue"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

const event = (overrides: Partial<OrderHistoryEvent>): OrderHistoryEvent => ({
  id: "e1",
  createdAt: "2026-10-18T10:00:00.000Z",
  action: "order.created",
  entityType: "order",
  entityId: "o1",
  result: "success",
  error: null,
  reqId: null,
  actor: { kind: "customer", name: "Jean Tireur" },
  oldValue: null,
  newValue: null,
  ...overrides,
})

const mounted = async () => {
  const wrapper = await mountSuspended(AdminOrderHistory, { props: { orderId: "o1" } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  apiMock.mockReset()
})

describe("AdminOrderHistory (story 12.7b)", () => {
  it("lists the order's events, oldest first, with who acted", async () => {
    apiMock.mockResolvedValue({
      data: [
        event({ id: "e1" }),
        event({ id: "e2", action: "order.payment.received", actor: { kind: "system", name: null } }),
      ],
    })
    const wrapper = await mounted()

    expect(apiMock).toHaveBeenCalledWith("/admin/orders/o1/history")
    const items = wrapper.findAll(".event")
    expect(items).toHaveLength(2)
    expect(items[0]?.text()).toContain("Commande passée")
    expect(items[0]?.text()).toContain("Jean Tireur (client)")
    expect(items[1]?.text()).toContain("Paiement : Payé")
    expect(items[1]?.text()).toContain("Automatique")
  })

  it("marks a failure and says why, with the request id to find the technical logs", async () => {
    apiMock.mockResolvedValue({
      data: [
        event({
          action: "payment.stripe.failed",
          result: "failure",
          error: "stripe.insufficient_funds",
          reqId: "req-abc",
          actor: { kind: "system", name: null },
        }),
      ],
    })
    const wrapper = await mounted()

    const item = wrapper.find(".event")
    expect(item.classes()).toContain("event--failure")
    expect(item.text()).toContain("Stripe : fonds insuffisants")
    expect(item.text()).toContain("req-abc")
  })

  it("says so when there is nothing yet, and when the history cannot be loaded", async () => {
    apiMock.mockResolvedValue({ data: [] })
    expect((await mounted()).text()).toContain("Aucun événement")

    apiMock.mockRejectedValue(new Error("down"))
    expect((await mounted()).find("[role='alert']").text()).toContain("Impossible de charger l'historique")
  })
})
