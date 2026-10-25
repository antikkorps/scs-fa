// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { computed, ref } from "vue"
import Detail from "./[id].vue"
import List from "./index.vue"

const { quotes, routeQuery, addressBook, navigateToMock } = vi.hoisted(() => ({
  quotes: { listRequests: vi.fn(), getRequest: vi.fn(), cancelRequest: vi.fn(), acceptQuote: vi.fn() },
  routeQuery: { value: {} as Record<string, string> },
  addressBook: { list: vi.fn(), create: vi.fn() },
  navigateToMock: vi.fn(),
}))
mockNuxtImport("useQuotes", () => () => quotes)
mockNuxtImport("useAddresses", () => () => addressBook)
mockNuxtImport("navigateTo", () => navigateToMock)
mockNuxtImport("useRoute", () => () => ({
  params: { id: "r1" },
  query: routeQuery.value,
  fullPath: "/pro/demandes/r1",
}))
mockNuxtImport("useProAccess", () => () => ({
  organisation: ref({ status: "approved" }),
  isApprovedPro: computed(() => true),
  load: vi.fn(),
}))

const REQUEST = {
  id: "r1",
  number: "DR-2026-0001",
  status: "requested",
  message: "Livraison au poste",
  validUntil: null,
  createdAt: "2026-10-21T10:00:00Z",
  updatedAt: "2026-10-21T10:00:00Z",
  items: [
    {
      id: "i1",
      position: 1,
      productId: "p1",
      productSlug: "gilet",
      productName: "Gilet niveau IIIA",
      productSku: "VEST-1",
      variantSku: "VEST-1-M",
      variantLabel: "Taille M",
      legalCategory: "none",
      qty: 12,
    },
  ],
}

beforeEach(() => {
  for (const fn of Object.values(quotes)) fn.mockReset()
  for (const fn of Object.values(addressBook)) fn.mockReset()
  navigateToMock.mockReset()
  addressBook.list.mockResolvedValue([
    {
      id: "a1",
      label: null,
      type: "both",
      firstName: "Jeanne",
      lastName: "Armand",
      line1: "3 quai du Stand",
      line2: null,
      postal: "69002",
      city: "Lyon",
      country: "FR",
      phone: null,
      isDefault: true,
    },
  ])
  routeQuery.value = {}
  quotes.listRequests.mockResolvedValue([{ ...REQUEST, lineCount: 1 }])
  quotes.getRequest.mockResolvedValue(REQUEST)
})

describe("pro/demandes (story 12.8c)", () => {
  it("lists the organisation's requests with their status", async () => {
    const wrapper = await mountSuspended(List, { route: "/pro/demandes" })
    await flushPromises()
    const row = wrapper.find(".request")
    expect(row.text()).toContain("DR-2026-0001")
    expect(row.text()).toContain("Envoyée")
    expect(row.text()).toContain("1 article")
    expect(row.find("a").attributes("href")).toBe("/pro/demandes/r1")
  })

  it("shows a request's lines and message, and confirms one just sent", async () => {
    routeQuery.value = { envoyee: "1" }
    const wrapper = await mountSuspended(Detail, { route: "/pro/demandes/r1" })
    await flushPromises()
    expect(wrapper.find("h1").text()).toContain("DR-2026-0001")
    expect(wrapper.text()).toContain("Demande envoyée")
    expect(wrapper.text()).toContain("Gilet niveau IIIA")
    expect(wrapper.text()).toContain("12")
    expect(wrapper.text()).toContain("Livraison au poste")
  })

  it("cancels a request SCS has not started on", async () => {
    quotes.cancelRequest.mockResolvedValue({ ...REQUEST, status: "cancelled" })
    vi.stubGlobal("confirm", () => true)
    const wrapper = await mountSuspended(Detail, { route: "/pro/demandes/r1" })
    await flushPromises()

    await wrapper.find("button.cancel").trigger("click")
    await flushPromises()
    expect(quotes.cancelRequest).toHaveBeenCalledWith("r1")
    expect(wrapper.text()).toContain("Annulée")
    expect(wrapper.find("button.cancel").exists()).toBe(false)
    vi.unstubAllGlobals()
  })

  it("offers no cancellation once SCS is on it", async () => {
    quotes.getRequest.mockResolvedValue({ ...REQUEST, status: "in_review" })
    const wrapper = await mountSuspended(Detail, { route: "/pro/demandes/r1" })
    await flushPromises()
    expect(wrapper.find("button.cancel").exists()).toBe(false)
  })

  // Story 12.8d — the quote, once issued.
  it("shows the issued quote: number, validity, prices, totals and its PDF", async () => {
    quotes.getRequest.mockResolvedValue({
      ...REQUEST,
      status: "sent",
      validUntil: "2026-11-24",
      quote: {
        number: "D-26-10-3",
        issuedAt: "2026-10-25T11:00:00Z",
        validUntil: "2026-11-24",
        items: [{ id: "i1", qty: 12, unitPriceHt: 356.4, lineHt: 4276.8 }],
        shippingTtc: 0,
        totals: { totalHt: 4276.8, vatAmount: 855.36, totalTtc: 5132.16 },
      },
    })
    const wrapper = await mountSuspended(Detail, { route: "/pro/demandes/r1" })
    await flushPromises()

    const quote = wrapper.find(".quote")
    expect(quote.text()).toContain("D-26-10-3")
    expect(quote.text()).toContain("24 nov. 2026")
    expect(wrapper.find(".line").text()).toMatch(/356,40\s?€/)
    expect(quote.text()).toMatch(/5\s?132,16\s?€/)
    expect(quote.text()).toContain("Port offert")
    expect(quote.find("a.download").attributes("href")).toBe("/bff/api/pro/quote-requests/r1/quote.pdf")
  })

  it("says the quote is being prepared while SCS works on it", async () => {
    quotes.getRequest.mockResolvedValue({ ...REQUEST, status: "in_review", quote: null })
    const wrapper = await mountSuspended(Detail, { route: "/pro/demandes/r1" })
    await flushPromises()
    expect(wrapper.find(".quote").exists()).toBe(false)
    expect(wrapper.text()).toContain("Notre équipe prépare votre devis")
  })

  // Story 12.8d-2 — accepting the quote.
  describe("accepting the quote", () => {
    const issued = (quote: Record<string, unknown> = {}) => ({
      ...REQUEST,
      status: "sent",
      validUntil: "2026-11-24",
      quote: {
        number: "D-26-10-3",
        issuedAt: "2026-10-25T11:00:00Z",
        validUntil: "2026-11-24",
        items: [{ id: "i1", qty: 12, unitPriceHt: 356.4, lineHt: 4276.8 }],
        shippingTtc: 0,
        totals: { totalHt: 4276.8, vatAmount: 855.36, totalTtc: 5132.16 },
        acceptable: true,
        refusal: null,
        net30: false,
        orderId: null,
        ...quote,
      },
    })

    async function mountIssued(quote: Record<string, unknown> = {}) {
      quotes.getRequest.mockResolvedValue(issued(quote))
      const wrapper = await mountSuspended(Detail, { route: "/pro/demandes/r1" })
      await flushPromises()
      return wrapper
    }

    it("places the order with the address, the terms and the Chorus Pro references, then opens it", async () => {
      quotes.acceptQuote.mockResolvedValue({ id: "o1", totalTtc: 5132.16 })
      const wrapper = await mountIssued()

      await wrapper.find("input[name='chorusServiceCode']").setValue("SRV-42")
      await wrapper.find("input[name='terms']").setValue(true)
      await wrapper.find("button.accept").trigger("click")
      await flushPromises()

      expect(quotes.acceptQuote).toHaveBeenCalledWith("r1", {
        shippingAddressId: "a1",
        acceptedTermsVersion: expect.any(String),
        chorusServiceCode: "SRV-42",
        chorusCommitmentNumber: "",
      })
      expect(navigateToMock).toHaveBeenCalledWith("/commande/o1")
    })

    it("asks for the terms before accepting", async () => {
      const wrapper = await mountIssued()
      await wrapper.find("button.accept").trigger("click")
      await flushPromises()
      expect(quotes.acceptQuote).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain("conditions générales de vente")
    })

    it("says how it will be paid: on invoice at 30 days, or within a week", async () => {
      expect((await mountIssued({ net30: true })).find(".accept-block").text()).toContain("30 jours")
      expect((await mountIssued()).find(".accept-block").text()).toContain("7 jours")
    })

    it("explains why it cannot be accepted yet, with where to file the documents", async () => {
      const wrapper = await mountIssued({ acceptable: false, refusal: "DocumentsRequired" })
      expect(wrapper.find("button.accept").exists()).toBe(false)
      expect(wrapper.text()).toContain("justificatifs")
      expect(wrapper.find("a[href='/pro/documents']").exists()).toBe(true)

      const expired = await mountIssued({ acceptable: false, refusal: "QuoteExpired" })
      expect(expired.text()).toContain("n'est plus valable")
    })

    it("explains a stock that no longer covers the quote", async () => {
      quotes.acceptQuote.mockRejectedValue({ statusCode: 409, data: { error: "InsufficientStock" } })
      const wrapper = await mountIssued()
      await wrapper.find("input[name='terms']").setValue(true)
      await wrapper.find("button.accept").trigger("click")
      await flushPromises()
      expect(wrapper.find(".accept-block").text()).toContain("stock")
      expect(navigateToMock).not.toHaveBeenCalled()
    })

    it("links to the order once accepted", async () => {
      quotes.getRequest.mockResolvedValue({ ...issued({ acceptable: false, orderId: "o1" }), status: "converted" })
      const wrapper = await mountSuspended(Detail, { route: "/pro/demandes/r1" })
      await flushPromises()
      expect(wrapper.find("a[href='/compte/commandes/o1']").exists()).toBe(true)
      expect(wrapper.find("button.accept").exists()).toBe(false)
    })
  })
})
