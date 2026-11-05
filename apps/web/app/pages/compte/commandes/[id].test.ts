// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { OrderDetail } from "~/types/checkout"
import OrderPage from "./[id].vue"

const { getOrder, orderLegal, ORDER_ID } = vi.hoisted(() => ({
  getOrder: vi.fn(),
  orderLegal: vi.fn(),
  ORDER_ID: "0b7d1f3e-8a51-4c1e-9d0a-2f6b1c3e4d5f",
}))
mockNuxtImport("useOrders", () => () => ({ get: getOrder }))
mockNuxtImport("useDocuments", () => () => ({
  orderLegal,
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
  orderLegal.mockReset().mockResolvedValue({ requiresVerification: false, requiredDocs: [] })
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

// UX audit 2026-11-01 (I2): "CNI", "SIA" meant nothing to a customer.
describe("my order — the documents to send", () => {
  it("names each document in full and says what the SIA is", async () => {
    getOrder.mockResolvedValue(order({ legalVerificationStatus: "pending" }))
    orderLegal.mockResolvedValue({
      requiresVerification: true,
      legalVerificationStatus: "pending",
      legalRejectionReason: null,
      requiredDocs: [
        { docType: "cni", status: "missing", documentId: null, uploadedAt: null, rejectionReason: null },
        { docType: "sia", status: "missing", documentId: null, uploadedAt: null, rejectionReason: null },
      ],
    })
    const wrapper = await mounted()
    const docs = wrapper.findAll(".doc").map((doc) => doc.text())
    expect(docs[0]).toContain("Pièce d'identité (carte d'identité ou passeport)")
    expect(docs[1]).toContain("Numéro de détenteur SIA")
    expect(docs[1]).toContain("Système d'information sur les armes")
    expect(wrapper.text()).toContain("Documents à fournir")
  })
})

// I7 — decision Franck 2026-11-04: category C takes either licence.
describe("my order — a line either licence satisfies", () => {
  it("names the line by both licences and lets the customer say which one they send", async () => {
    getOrder.mockResolvedValue(order({ legalVerificationStatus: "pending" }))
    orderLegal.mockResolvedValue({
      requiresVerification: true,
      legalVerificationStatus: "pending",
      legalRejectionReason: null,
      requiredDocs: [
        {
          docType: "permis_chasse",
          alternatives: ["permis_chasse", "licence_tir"],
          status: "missing",
          documentId: null,
          uploadedAt: null,
          rejectionReason: null,
        },
      ],
    })
    const wrapper = await mounted()
    const line = wrapper.find(".doc")
    expect(line.find(".doc__name").text()).toBe("Permis de chasser validé ou licence de tir sportif")

    await line.find("button.btn-primary").trigger("click")

    const choices = wrapper.findAll(".doc input[type=radio]").map((choice) => choice.attributes("value"))
    expect(choices).toEqual(["permis_chasse", "licence_tir"])
  })
})
