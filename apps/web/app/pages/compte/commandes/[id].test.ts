// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { OrderDetail } from "~/types/checkout"
import OrderPage from "./[id].vue"

const { getOrder, ORDER_ID } = vi.hoisted(() => ({
  getOrder: vi.fn(),
  ORDER_ID: "0b7d1f3e-8a51-4c1e-9d0a-2f6b1c3e4d5f",
}))
mockNuxtImport("useOrders", () => () => ({ get: getOrder }))
mockNuxtImport("useDocuments", () => () => ({
  orderLegal: () => Promise.resolve({ requiresVerification: false, requiredDocs: [] }),
  get: vi.fn(),
}))
mockNuxtImport("useRoute", () => () => ({
  params: { id: ORDER_ID },
  query: {},
  path: `/compte/commandes/${ORDER_ID}`,
  fullPath: `/compte/commandes/${ORDER_ID}`,
}))

function order(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: ORDER_ID,
    createdAt: "2026-10-14T09:00:00.000Z",
    updatedAt: "2026-10-14T09:00:00.000Z",
    legalVerificationStatus: "completed",
    paymentStatus: "partially_refunded",
    paymentDueAt: null,
    subtotalHt: 200,
    vatAmount: 25.5,
    totalTtc: 225.5,
    vipDiscountAmount: 0,
    vipDiscountAppliedPct: 0,
    shippingCost: 0,
    shippingHt: 0,
    items: [],
    shippingAddress: null,
    billingAddress: null,
    shippingStatus: "unshipped",
    shipments: [],
    invoices: [],
    payment: { carte: { status: "received", amountTtc: 225.5 }, virement: null },
    ...overrides,
  }
}

beforeEach(() => {
  getOrder.mockReset()
})

const mounted = async () => {
  const wrapper = await mountSuspended(OrderPage, { route: `/compte/commandes/${ORDER_ID}` })
  await flushPromises()
  return wrapper
}

describe("my order — invoices (story 12.6)", () => {
  it("lists the invoice and credit notes issued, each with its download link", async () => {
    getOrder.mockResolvedValue(
      order({
        invoices: [
          { id: "d-1", kind: "invoice", number: "26-10-1", amountTtc: 225.5, issuedAt: "2026-10-14T10:00:00.000Z" },
          { id: "d-2", kind: "credit_note", number: "26-10-2", amountTtc: 105.5, issuedAt: "2026-10-15T10:00:00.000Z" },
        ],
      }),
    )
    const wrapper = await mounted()

    const rows = wrapper.findAll(".invoices__row")
    expect(rows).toHaveLength(2)
    expect(rows[0]?.text()).toContain("Facture 26-10-1")
    expect(rows[1]?.text()).toContain("Avoir 26-10-2")
    expect(rows[0]?.find("a").attributes("href")).toBe(`/bff/api/orders/${ORDER_ID}/invoices/d-1/pdf`)
    expect(rows[0]?.find("a").attributes("download")).toBeDefined()
  })

  it("shows no invoice section before Henrri has issued one", async () => {
    getOrder.mockResolvedValue(order())
    const wrapper = await mounted()
    expect(wrapper.find("#invoices-h").exists()).toBe(false)
  })
})

describe("my order — unpaid orders (story 12.9a)", () => {
  it("says until when an unpaid order can be paid", async () => {
    getOrder.mockResolvedValue(
      order({
        paymentStatus: "pending",
        paymentDueAt: "2026-10-21T09:00:00.000Z",
        payment: { carte: null, virement: null },
      }),
    )
    const wrapper = await mounted()
    expect(wrapper.find(".cta-pay").text()).toContain("Procéder au paiement")
    expect(wrapper.find(".cta-pay__deadline").text()).toContain("À régler avant le")
  })

  it("tells a cancelled order apart, with nothing left to pay or upload", async () => {
    getOrder.mockResolvedValue(order({ paymentStatus: "cancelled", payment: { carte: null, virement: null } }))
    const wrapper = await mounted()
    expect(wrapper.text()).toContain("Commande annulée faute de paiement")
    expect(wrapper.text()).not.toContain("Procéder au paiement")
  })
})

describe("my order — prices (audit 2026-11-01, I4)", () => {
  // A rifle at 1,000 € HT with 100 € HT of VIP discount, 20 % VAT, 25 € delivery TTC.
  const rifleOrder = (overrides: Partial<OrderDetail> = {}) =>
    order({
      subtotalHt: 1000,
      vipDiscountAmount: 100,
      vipDiscountAppliedPct: 10,
      shippingCost: 25,
      shippingHt: 20.83,
      vatAmount: 184.17,
      totalTtc: 1105,
      items: [{ name: "Carabine", qty: 1, priceHt: 1000, vatPct: 20, discountHt: 100 }],
      ...overrides,
    })

  it("shows an individual every amount VAT included, the VAT as part of the total", async () => {
    getOrder.mockResolvedValue(rifleOrder())
    const text = (await mounted()).find(".block .totals").element.closest("section")?.textContent ?? ""
    expect(text).not.toMatch(/\bHT\b/)
    expect(text).toMatch(/1\s200,00\s*€ TTC/)
    expect(text).toMatch(/Articles\s*1\s200,00/)
    expect(text).toMatch(/Remise VIP[^−]*−\s*120,00/)
    expect(text).toMatch(/Livraison\s*25,00/)
    expect(text).toMatch(/Total TTC\s*1\s105,00/)
    expect(text).toMatch(/dont TVA\s*184,17/)
  })

  it("keeps a pro order (born of a quote) HT, as the pro space shows it", async () => {
    getOrder.mockResolvedValue(rifleOrder({ quoteRequestId: "q-1", vipDiscountAmount: 0 }))
    const text = (await mounted()).text()
    expect(text).toContain("Sous-total HT")
    expect(text).toMatch(/1\s000,00\s*€ HT/)
  })
})
