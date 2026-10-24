// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { setClientErrorReporter } from "~/utils/clientErrors"
import StripeCardPayment from "./StripeCardPayment.vue"

const { loadStripeMock, createStripeIntentMock } = vi.hoisted(() => ({
  loadStripeMock: vi.fn(),
  createStripeIntentMock: vi.fn(),
}))

vi.mock("@stripe/stripe-js", () => ({ loadStripe: loadStripeMock }))
mockNuxtImport("useOrders", () => () => ({ createStripeIntent: createStripeIntentMock }))

const report = vi.fn()

function fakeStripe(confirmPayment = vi.fn()) {
  return {
    elements: () => ({ create: () => ({ mount: vi.fn() }) }),
    confirmPayment,
  }
}

const mounted = async () => {
  const wrapper = await mountSuspended(StripeCardPayment, { props: { orderId: "o1", amount: 120 } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  report.mockReset()
  setClientErrorReporter(report)
  createStripeIntentMock.mockReset().mockResolvedValue({ clientSecret: "pi_secret" })
  loadStripeMock.mockReset()
})

afterEach(() => setClientErrorReporter(null))

describe("StripeCardPayment — browser errors (story 12.7d)", () => {
  it("reports Stripe.js that did not load", async () => {
    loadStripeMock.mockResolvedValue(null)
    await mounted()
    expect(report).toHaveBeenCalledWith("stripe", expect.objectContaining({ message: "Stripe.js did not load" }))
  })

  it("reports Stripe.js that failed to load (a blocked script)", async () => {
    loadStripeMock.mockRejectedValue(new Error("Failed to load Stripe.js"))
    await mounted()
    expect(report).toHaveBeenCalledWith("stripe", expect.objectContaining({ message: "Failed to load Stripe.js" }))
  })

  it("leaves an unreachable API to useApi, which already reported it", async () => {
    createStripeIntentMock.mockRejectedValue(Object.assign(new Error("fetch failed"), { name: "FetchError" }))
    await mounted()
    expect(report).not.toHaveBeenCalled()
  })

  it("reports a Stripe failure with its code, but not a declined card", async () => {
    const confirmPayment = vi
      .fn()
      .mockResolvedValueOnce({ error: { type: "card_error", code: "card_declined", message: "Carte refusée" } })
      .mockResolvedValueOnce({
        error: { type: "api_connection_error", code: "api_connection_error", message: "Connexion à Stripe perdue" },
      })
    loadStripeMock.mockResolvedValue(fakeStripe(confirmPayment))
    const wrapper = await mounted()

    await wrapper.find(".card-pay__btn").trigger("click")
    await flushPromises()
    expect(report).not.toHaveBeenCalled()

    await wrapper.find(".card-pay__btn").trigger("click")
    await flushPromises()
    expect(report).toHaveBeenCalledWith("stripe", expect.objectContaining({ message: "Connexion à Stripe perdue" }), {
      code: "api_connection_error",
    })
  })
})

// Story 12.9g — a 409 on init is not always "already paid".
describe("StripeCardPayment — refused initialisation", () => {
  const refused = (error: string) => ({ response: { status: 409 }, data: { error } })

  it("treats an already settled card payment as paid", async () => {
    createStripeIntentMock.mockRejectedValue(refused("AlreadyPaid"))
    const wrapper = await mounted()
    expect(wrapper.emitted("paid")).toHaveLength(1)
  })

  it("retries once when another payment attempt started at the same time", async () => {
    createStripeIntentMock.mockRejectedValueOnce(refused("PaymentInitConflict"))
    loadStripeMock.mockResolvedValue(fakeStripe())
    const wrapper = await mounted()
    expect(createStripeIntentMock).toHaveBeenCalledTimes(2)
    expect(wrapper.emitted("paid")).toBeUndefined()
    expect(wrapper.find(".card-pay__btn").exists()).toBe(true)
  })

  it("never calls a cancelled order paid", async () => {
    createStripeIntentMock.mockRejectedValue(refused("OrderCancelled"))
    const wrapper = await mounted()
    expect(wrapper.emitted("paid")).toBeUndefined()
    expect(wrapper.text()).toContain("Cette commande a été annulée")
  })
})
