// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { clearNuxtData } from "#imports"
import type { AdminOrderDetail, HenrriDocumentRow } from "~/types/admin"
import OrderPage from "./[id].vue"

const { apiMock, ORDER_ID } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  ORDER_ID: "0b7d1f3e-8a51-4c1e-9d0a-2f6b1c3e4d5f",
}))
mockNuxtImport("useApi", () => () => apiMock)
mockNuxtImport("useRoute", () => () => ({
  params: { id: ORDER_ID },
  query: {},
  path: `/admin/orders/${ORDER_ID}`,
  fullPath: `/admin/orders/${ORDER_ID}`,
}))

function henrriDocument(overrides: Partial<HenrriDocumentRow>): HenrriDocumentRow {
  return {
    id: "d-1",
    kind: "invoice",
    status: "finalized",
    number: "26-10-1",
    amountTtc: 225.5,
    refundId: null,
    lastError: null,
    held: false,
    attempts: 1,
    finalizedAt: "2026-10-14T10:00:00.000Z",
    paymentRecordedAt: "2026-10-14T10:00:00.000Z",
    createdAt: "2026-10-14T10:00:00.000Z",
    ...overrides,
  }
}

function order(overrides: Partial<AdminOrderDetail> = {}): AdminOrderDetail {
  return {
    id: ORDER_ID,
    createdAt: "2026-10-14T09:00:00.000Z",
    updatedAt: "2026-10-14T09:00:00.000Z",
    legalVerificationStatus: "completed",
    legalRejectionReason: null,
    paymentStatus: "received",
    shippingStatus: "unshipped",
    shipGate: { ok: true },
    shipments: [],
    suggestedParcels: [],
    subtotalHt: 200,
    vatAmount: 25.5,
    totalTtc: 225.5,
    vipDiscountAmount: 0,
    shippingCost: 0,
    shippingHt: 0,
    items: [
      {
        qty: 1,
        priceHt: 100,
        name: "Tapis de tir",
        sku: "TAP-1",
        category: "accessoire-tireur",
        requiresPaymentVirement: false,
      },
      { qty: 1, priceHt: 100, name: "Estampe", sku: "1/25", category: "gun-art", requiresPaymentVirement: false },
    ],
    shippingAddress: null,
    billingAddress: null,
    user: { id: "u-1", email: "jean@example.test", firstname: "Jean", lastname: "Tireur" },
    payment: {
      carte: {
        id: "c-1",
        amountTtc: "225.50",
        currency: "EUR",
        paymentStatus: "received",
        stripePaymentIntentId: "pi_1",
        last4: "4242",
      } as AdminOrderDetail["payment"]["carte"],
      virement: null,
      refunds: [],
    },
    henrri: [henrriDocument({})],
    ...overrides,
  }
}

let current: AdminOrderDetail

beforeEach(() => {
  // The page caches its order under a fixed key: each test starts from its own.
  clearNuxtData()
  current = order()
  apiMock.mockReset()
  apiMock.mockImplementation((url: string) => {
    if (url.endsWith("/refunds/preview")) return Promise.resolve({ data: { amountTtc: 105.5 } })
    if (url.endsWith("/henrri/retry")) return Promise.resolve({ data: [] })
    return Promise.resolve({ data: current })
  })
})

const mounted = () => mountSuspended(OrderPage, { route: `/admin/orders/${ORDER_ID}` })

describe("admin order — born of a pro quote (story 12.8d)", () => {
  it("shows payment on invoice, its due date, lateness and the Chorus Pro references", async () => {
    current = order({
      paymentStatus: "pending",
      quoteRequestId: "q-1",
      paymentTerms: "net30",
      paymentDueAt: "2026-11-25T10:00:00.000Z",
      paymentLate: true,
      chorusServiceCode: "SRV-42",
      chorusCommitmentNumber: "EJ-2026-118",
    })
    const wrapper = await mounted()

    const pro = wrapper.find(".pro-order")
    expect(pro.text()).toContain("Sur facture, à 30 jours")
    expect(pro.text()).toContain("25 nov. 2026")
    expect(pro.text()).toContain("En retard")
    expect(pro.text()).toContain("SRV-42")
    expect(pro.text()).toContain("EJ-2026-118")
    expect(pro.find("a[href='/admin/devis']").exists()).toBe(true)
  })

  it("shows nothing of the kind for a shop order", async () => {
    expect((await mounted()).find(".pro-order").exists()).toBe(false)
  })
})

describe("admin order — Henrri invoicing (story 12.6)", () => {
  it("shows the invoice with its number and state", async () => {
    const wrapper = await mounted()
    expect(wrapper.text()).toContain("Facture 26-10-1")
    expect(wrapper.text()).toContain("Émise")
    expect(wrapper.text()).not.toContain("Relancer la facturation")
  })

  it("explains a blocked document and offers to retry it", async () => {
    current = order({ henrri: [henrriDocument({ status: "blocked", number: null, lastError: "LegacySnapshot" })] })
    const wrapper = await mounted()
    expect(wrapper.text()).toContain("Commande antérieure à la facturation automatique")

    const retry = wrapper.findAll("button").find((button) => button.text() === "Relancer la facturation")
    await retry?.trigger("click")
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith(`/admin/orders/${ORDER_ID}/henrri/retry`, { method: "POST" })
  })

  it("shows an issued invoice held for an admin as such, with a retry", async () => {
    current = order({
      henrri: [
        henrriDocument({
          held: true,
          paymentRecordedAt: null,
          lastError: "PaymentMismatch: received 220.50, invoiced 225.50",
        }),
      ],
    })
    const wrapper = await mounted()
    expect(wrapper.text()).toContain("Émise — à vérifier")
    expect(wrapper.text()).toContain("ne couvrent pas la facture")
    expect(wrapper.text()).toContain("Relancer la facturation")
  })
})

describe("admin order — refunds (decisions 2026-10-14)", () => {
  async function openRefund() {
    const wrapper = await mounted()
    const open = wrapper.findAll("button").find((button) => button.text() === "Rembourser")
    await open?.trigger("click")
    await flushPromises()
    return wrapper
  }

  it("starts with a goods return, listing the articles that can come back", async () => {
    const wrapper = await openRefund()
    expect((wrapper.find(".modal select").element as HTMLSelectElement).value).toBe("goods_return")
    expect(wrapper.findAll(".returns__qty")).toHaveLength(2)
  })

  it("asks the API what a return comes to, and shows it", async () => {
    const wrapper = await openRefund()
    await wrapper.findAll(".returns__qty")[1]?.setValue(1)
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith(`/admin/payments/orders/${ORDER_ID}/refunds/preview`, {
      method: "POST",
      body: { kind: "goods_return", channel: "carte", lines: [{ item: 1, qty: 1 }], includesShipping: false },
    })
    expect(wrapper.find(".returns__amount").text()).toContain("105,50")
  })

  it("greys out an article already returned in full", async () => {
    current = order({
      payment: {
        ...order().payment,
        refunds: [
          {
            id: "r-1",
            channel: "carte",
            kind: "goods_return",
            lines: [{ item: 1, qty: 1 }],
            includesShipping: false,
            amountTtc: "105.50",
            status: "succeeded",
            reason: null,
            stripeRefundId: "re_1",
            createdAt: "2026-10-14T11:00:00.000Z",
          },
        ],
      },
    })
    const wrapper = await openRefund()
    expect(wrapper.findAll(".returns__qty")[1]?.attributes("disabled")).toBeDefined()
  })

  it("offers the closest amounts when a gesture cannot be credited exactly", async () => {
    const wrapper = await openRefund()
    await wrapper.find(".modal select").setValue("goodwill")
    await wrapper.find('.modal input[type="number"]').setValue(33.33)
    apiMock.mockRejectedValueOnce({
      data: { error: "InexpressibleRefundAmount", suggestions: { below: 33.32, above: 33.34 } },
    })
    await wrapper.find(".modal form").trigger("submit")
    await flushPromises()

    const suggestions = wrapper.findAll(".modal__suggestions button").map((button) => button.text().replace(/\s/g, " "))
    expect(suggestions).toEqual(["33,32 €", "33,34 €"])
  })

  // Story 12.9g — each refund carries its own key: a resend never refunds twice.
  describe("idempotency key", () => {
    const refundCalls = () => apiMock.mock.calls.filter(([url]) => url === `/admin/payments/orders/${ORDER_ID}/refunds`)
    const keyOf = (call: unknown[] | undefined) =>
      (call?.[1] as { headers?: Record<string, string> } | undefined)?.headers?.["Idempotency-Key"]

    async function submitGesture(wrapper: Awaited<ReturnType<typeof openRefund>>) {
      await wrapper.find(".modal select").setValue("goodwill")
      await wrapper.find('.modal input[type="number"]').setValue(20)
      await wrapper.find(".modal form").trigger("submit")
      await flushPromises()
    }

    it("sends the same key again when the first request got no answer", async () => {
      const wrapper = await openRefund()
      apiMock.mockRejectedValueOnce(Object.assign(new Error("fetch failed"), { name: "FetchError" }))
      await submitGesture(wrapper)
      await wrapper.find(".modal form").trigger("submit")
      await flushPromises()

      const [first, second] = refundCalls()
      expect(keyOf(first)).toMatch(/^[0-9a-f-]{36}$/)
      expect(keyOf(second)).toBe(keyOf(first))
    })

    it("uses a new key once the API has answered", async () => {
      const wrapper = await openRefund()
      apiMock.mockRejectedValueOnce({ response: { status: 400 }, data: { error: "AmountExceedsRefundable" } })
      await submitGesture(wrapper)
      await wrapper.find(".modal form").trigger("submit")
      await flushPromises()

      const [first, second] = refundCalls()
      expect(keyOf(second)).toBeDefined()
      expect(keyOf(second)).not.toBe(keyOf(first))
    })
  })
})
