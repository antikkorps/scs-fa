// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SHOP_NOT_OPEN_MESSAGE } from "~/utils/launch"
import ProQuoteButton from "./ProQuoteButton.vue"

const { addToBasket } = vi.hoisted(() => ({ addToBasket: vi.fn() }))
mockNuxtImport("useQuotes", () => () => ({ addToBasket }))

beforeEach(() => {
  addToBasket.mockReset().mockResolvedValue({ items: [] })
})

describe("ProQuoteButton (story 12.8c)", () => {
  it("adds the shop's variant to the pro's request", async () => {
    const wrapper = await mountSuspended(ProQuoteButton, { props: { variantId: "v1" } })
    expect(wrapper.find("button").text()).toBe("Ajouter à ma demande de devis")

    await wrapper.find("button").trigger("click")
    await flushPromises()

    expect(addToBasket).toHaveBeenCalledWith("v1", 1)
    expect(wrapper.text()).toContain("Ajouté à votre demande")
    expect(wrapper.find('a[href="/pro/demande"]').exists()).toBe(true)
  })

  it("says why an item cannot go into a request", async () => {
    addToBasket.mockRejectedValue({ response: { status: 404 }, data: { error: "NotAvailableForQuote" } })
    const wrapper = await mountSuspended(ProQuoteButton, { props: { variantId: "v1" } })
    await wrapper.find("button").trigger("click")
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain("n'est pas proposé sur devis")
  })

  it("says the shop is not open yet (story 12.10)", async () => {
    addToBasket.mockRejectedValue({ response: { status: 403 }, data: { error: "ShopNotOpen" } })
    const wrapper = await mountSuspended(ProQuoteButton, { props: { variantId: "v1" } })
    await wrapper.find("button").trigger("click")
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toBe(SHOP_NOT_OPEN_MESSAGE)
  })
})
