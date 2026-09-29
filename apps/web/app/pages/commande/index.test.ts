// @vitest-environment nuxt

import { CURRENT_TERMS_VERSION } from "@armurier/shared"
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
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

const summary = { itemCount: 1, subtotalHt: 100, vipDiscountAmount: 0, vatAmount: 20, totalTtc: 120 }

beforeEach(() => {
  vi.clearAllMocks()
  fetchCart.mockResolvedValue({ items: [], artworkItems: [], summary })
  listAddresses.mockResolvedValue([
    {
      id: "addr-1",
      firstName: "Jean",
      lastName: "Dupont",
      line1: "1 rue X",
      postal: "75001",
      city: "Paris",
      isDefault: true,
    },
  ])
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
