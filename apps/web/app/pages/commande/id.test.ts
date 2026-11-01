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
mockNuxtImport("useOrders", () => () => ({ get: getOrder, claimVirement: vi.fn() }))
mockNuxtImport("useRoute", () => () => ({
  params: { id: ORDER_ID },
  query: {},
  path: `/commande/${ORDER_ID}`,
  fullPath: `/commande/${ORDER_ID}`,
}))

const VIREMENT = {
  status: "awaiting_transfer",
  amountTtc: 432,
  reference: "SCS-0B7D1F3E",
  iban: "FR7630006000011234567890189",
  bic: "AGRIFRPP",
  bankName: "Banque",
  accountHolder: "SCS Firearms SAS",
}

function order(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: ORDER_ID,
    createdAt: "2026-11-01T09:00:00.000Z",
    updatedAt: "2026-11-01T09:00:00.000Z",
    legalVerificationStatus: "pending",
    paymentStatus: "awaiting_transfer",
    paymentDueAt: "2026-11-08T09:00:00.000Z",
    subtotalHt: 360,
    vatAmount: 72,
    totalTtc: 432,
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
    payment: { carte: null, virement: VIREMENT },
    ...overrides,
  }
}

const mounted = async () => {
  const wrapper = await mountSuspended(OrderPage)
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  getOrder.mockReset()
})

describe("commande/[id].vue — a regulated order's next steps (UX audit 2026-11-01)", () => {
  it("leads with the documents, before the bank details", async () => {
    getOrder.mockResolvedValue(order())
    const wrapper = await mounted()

    expect(wrapper.find("h1").text()).toBe("Plus que deux étapes")
    const steps = wrapper.findAll("ol.steps > li").map((step) => step.text())
    expect(steps).toHaveLength(3)
    expect(steps[0]).toMatch(/Envoyez vos pièces justificatives/)
    expect(steps[1]).toMatch(/Réglez votre commande/)
    expect(steps[2]).toMatch(/48 heures/)

    const upload = wrapper.find("a.steps__cta")
    expect(upload.text()).toBe("Envoyer mes documents")
    expect(upload.attributes("href")).toBe(`/compte/commandes/${ORDER_ID}`)
    // The call to action comes before the RIB in the page.
    const html = wrapper.html()
    expect(html.indexOf("steps__cta")).toBeLessThan(html.indexOf("IBAN"))
  })

  it("asks again for documents after a refusal", async () => {
    getOrder.mockResolvedValue(order({ legalVerificationStatus: "docs_rejected" }))
    const wrapper = await mounted()
    expect(wrapper.find("ol.steps > li").text()).toMatch(/refusée/)
    expect(wrapper.find("a.steps__cta").exists()).toBe(true)
  })

  it("marks the documents step as in review once they are sent", async () => {
    getOrder.mockResolvedValue(order({ legalVerificationStatus: "docs_verifying" }))
    const wrapper = await mounted()
    expect(wrapper.find("h1").text()).toBe("Plus qu'une étape")
    expect(wrapper.find("ol.steps > li").text()).toMatch(/en cours de vérification/)
    expect(wrapper.find("a.steps__cta").exists()).toBe(false)
  })

  it("keeps the plain thank-you for an order with nothing regulated", async () => {
    getOrder.mockResolvedValue(order({ legalVerificationStatus: "payment_pending" }))
    const wrapper = await mounted()
    expect(wrapper.find("h1").text()).toBe("Merci pour votre commande")
    expect(wrapper.find("ol.steps").exists()).toBe(false)
  })
})
