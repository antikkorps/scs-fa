// @vitest-environment nuxt

import { CURRENT_TERMS_VERSION } from "@armurier/shared"
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { formatEuros } from "~/utils/format"
import Commande from "./index.vue"

const { fetchCart, listAddresses, createOrder, push } = vi.hoisted(() => ({
  fetchCart: vi.fn(),
  listAddresses: vi.fn(),
  createOrder: vi.fn(),
  push: vi.fn(),
}))

mockNuxtImport("useCart", () => () => ({ fetchCart, count: { value: 1 } }))
mockNuxtImport("useAddresses", () => () => ({ list: listAddresses, create: vi.fn() }))
mockNuxtImport("useOrders", () => () => ({ create: createOrder }))
mockNuxtImport("useRouter", (original) => () => ({ ...original(), push }))

const summary = {
  itemCount: 1,
  subtotalHt: 100,
  vipDiscountAmount: 0,
  vatAmount: 21.5,
  totalTtc: 129,
  shipping: {
    totalTtc: 9,
    totalHt: 7.5,
    vatAmount: 1.5,
    breakdown: [{ shippingClass: "small", units: 1, amountTtc: 9 }],
    smallParcelFree: false,
    smallParcelFreeRemainingTtc: 21,
    portions: [],
  },
}

const address = (overrides: Record<string, unknown> = {}) => ({
  id: "addr-1",
  firstName: "Jean",
  lastName: "Dupont",
  line1: "1 rue X",
  postal: "75001",
  city: "Paris",
  country: "FR",
  isDefault: true,
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  fetchCart.mockResolvedValue({ items: [], artworkItems: [], summary })
  listAddresses.mockResolvedValue([address()])
})

async function mountCheckout() {
  const wrapper = await mountSuspended(Commande)
  await flushPromises()
  return wrapper
}

describe("commande/index.vue — CGV acceptance (story 12.1)", () => {
  it("shows an unticked CGV box linking to /cgv, and a button that states the obligation to pay", async () => {
    const wrapper = await mountCheckout()
    const box = wrapper.find('input[name="terms"]')
    expect((box.element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.find('a[href="/cgv"]').exists()).toBe(true)
    expect(wrapper.find(".summary__cta").text()).toBe("Commander avec obligation de paiement")
  })

  it("refuses to order until the CGV are accepted", async () => {
    const wrapper = await mountCheckout()
    await wrapper.find(".summary__cta").trigger("click")
    await flushPromises()
    expect(createOrder).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain("Acceptez les conditions générales de vente pour commander.")
  })

  it("sends the CGV version the customer accepted", async () => {
    createOrder.mockResolvedValue({ id: "ord-1" })
    const wrapper = await mountCheckout()
    await wrapper.find('input[name="terms"]').setValue(true)
    await wrapper.find(".summary__cta").trigger("click")
    await flushPromises()
    expect(createOrder).toHaveBeenCalledWith({
      shippingAddressId: "addr-1",
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
    })
    expect(push).toHaveBeenCalledWith("/commande/ord-1")
  })

  it("asks to reload when the CGV changed after the page was opened", async () => {
    createOrder.mockRejectedValue({ response: { status: 409 }, data: { error: "TermsOutdated" } })
    const wrapper = await mountCheckout()
    await wrapper.find('input[name="terms"]').setValue(true)
    await wrapper.find(".summary__cta").trigger("click")
    await flushPromises()
    expect(wrapper.text()).toContain("Rechargez la page pour lire la nouvelle version.")
  })
})

describe("commande/index.vue — cart changed (story 12.9d)", () => {
  it("shows what changed, refreshes the summary, and lets the customer confirm again", async () => {
    const refreshed = {
      items: [{ id: "l-1", vatPct: 20, heldUntil: null }],
      artworkItems: [],
      summary: { ...summary, totalTtc: 999 },
    }
    createOrder.mockRejectedValue({
      response: { status: 409 },
      data: {
        error: "CartChanged",
        changes: [{ kind: "price_changed", lineId: "l-1", name: "Tapis de tir", previousPriceHt: 50, priceHt: 55 }],
        cart: refreshed,
      },
    })
    const wrapper = await mountCheckout()
    await wrapper.find('input[name="terms"]').setValue(true)
    await wrapper.find(".summary__cta").trigger("click")
    await flushPromises()

    expect(wrapper.find(".cart-changes").text()).toContain("Tapis de tir : le prix est passé de")
    expect(wrapper.text()).toContain("Votre panier a changé")
    expect(wrapper.find(".summary__cta").attributes("disabled")).toBeUndefined()
  })
})

describe("commande/index.vue — shipping (story 12.3)", () => {
  it("shows the delivery cost in the summary before ordering", async () => {
    const wrapper = await mountCheckout()
    const text = wrapper.find(".summary").text()
    expect(text).toContain("Livraison")
    expect(text).not.toMatch(/\bHT\b/)
    expect(text).toContain("Munitions et accessoires")
    expect(text).toMatch(/129,00/)
  })

  it("refuses an overseas delivery address before calling the API", async () => {
    listAddresses.mockResolvedValue([address({ postal: "97400", city: "Saint-Denis" })])
    const wrapper = await mountCheckout()
    expect(wrapper.text()).toContain("Nous livrons uniquement en France métropolitaine")
    await wrapper.find('input[name="terms"]').setValue(true)
    await wrapper.find(".summary__cta").trigger("click")
    await flushPromises()
    expect(createOrder).not.toHaveBeenCalled()
  })

  it("explains the API's refusal of an undeliverable address", async () => {
    createOrder.mockRejectedValue({ response: { status: 422 }, data: { error: "UndeliverableAddress" } })
    const wrapper = await mountCheckout()
    await wrapper.find('input[name="terms"]').setValue(true)
    await wrapper.find(".summary__cta").trigger("click")
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain("France métropolitaine, Corse comprise")
  })
})

// UX audit 2026-11-01 (I5): the summary showed totals without saying what they were for.
describe("commande/index.vue — what is being ordered", () => {
  it("lists every article in the summary, with its quantity and its price tax included", async () => {
    fetchCart.mockResolvedValue({
      items: [
        {
          id: "l-1",
          name: "Carabine .22 LR",
          finition: "Inox",
          munition: null,
          couleur: null,
          qty: 2,
          vatPct: 20,
          lineTtc: 1200,
          heldUntil: null,
        },
      ],
      artworkItems: [
        {
          id: "a-1",
          title: "Éclat de Bronze",
          printDesignation: "7/25",
          formatId: "A2",
          vatPct: 20,
          lineTtc: 450,
          heldUntil: "2099-01-01T00:00:00.000Z",
        },
      ],
      summary: { ...summary, itemCount: 3 },
    })
    const wrapper = await mountCheckout()
    const lines = wrapper.findAll(".summary .order-lines li").map((line) => line.text())
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain("Carabine .22 LR")
    expect(lines[0]).toContain("Inox")
    expect(lines[0]).toContain("× 2")
    expect(lines[0]).toContain(formatEuros(1200))
    expect(lines[1]).toContain("Éclat de Bronze")
    expect(lines[1]).toContain("Tirage 7/25 · A2")
    expect(lines[1]).toContain(formatEuros(450))
  })
})
