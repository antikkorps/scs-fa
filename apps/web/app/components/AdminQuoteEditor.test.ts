// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AdminQuoteRequestDetail } from "~/types/quote"
import AdminQuoteEditor from "./AdminQuoteEditor.vue"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

const quote = (overrides: Partial<AdminQuoteRequestDetail> = {}): AdminQuoteRequestDetail => ({
  id: "r1",
  number: "DR-2026-0001",
  status: "in_review",
  message: null,
  validUntil: "2026-11-24",
  createdAt: "2026-10-25T10:00:00Z",
  updatedAt: "2026-10-25T10:00:00Z",
  sentAt: null,
  organisation: {
    id: "o1",
    legalName: "Armurerie du Stand",
    siret: "73282932000074",
    type: "armurier",
    status: "approved",
    discountPct: 10,
    net30Allowed: false,
    showPrices: false,
    billingAddress: { line1: "12 rue de la Paix", line2: null, postal: "75002", city: "Paris", country: "FR" },
    billingAddressComplete: true,
  },
  requester: { id: "u1", email: "jeanne@stand.fr", firstName: "Jeanne", lastName: "Armand" },
  items: [
    {
      id: "i1",
      position: 1,
      productId: "p1",
      productSlug: "carabine",
      productName: "Carabine Tikka",
      productSku: "TIK",
      variantSku: "TIK-308",
      variantLabel: "Calibre .308",
      legalCategory: "C",
      qty: 3,
      publicPriceHt: 1205,
      vatPct: 20,
      quotedPriceHt: 1084.5,
      lineDiscountPct: 10,
    },
  ],
  shippingTtc: 75,
  totals: { totalHt: 3316, vatAmount: 663.2, totalTtc: 3979.2 },
  totalTtc: null,
  requiresDocuments: true,
  documentsSufficient: null,
  henrri: null,
  sending: false,
  organisationDocuments: [
    { id: "doc1", docType: "agrement_armurier", verificationStatus: "approved", expiresAt: "2030-12-31" },
    { id: "doc2", docType: "autorisation_commerce", verificationStatus: "pending", expiresAt: null },
  ],
  ...overrides,
})

const mountEditor = (detail = quote()) => mountSuspended(AdminQuoteEditor, { props: { quote: detail } })
const callTo = (suffix: string) => apiMock.mock.calls.find(([url]) => String(url).endsWith(suffix))

beforeEach(() => {
  apiMock.mockReset()
  apiMock.mockResolvedValue({ data: quote() })
})

describe("AdminQuoteEditor (story 12.8d)", () => {
  it("shows each line's quoted price and discount, the delivery, the validity and the totals", async () => {
    const wrapper = await mountEditor()

    expect((wrapper.find("input[name='price-i1']").element as HTMLInputElement).value).toBe("1084.5")
    expect((wrapper.find("input[name='discount-i1']").element as HTMLInputElement).value).toBe("10")
    expect((wrapper.find("input[name='shipping']").element as HTMLInputElement).value).toBe("75")
    expect((wrapper.find("input[name='valid-until']").element as HTMLInputElement).value).toBe("2026-11-24")
    expect(wrapper.text()).toMatch(/3\s?979,20\s?€/)
  })

  it("saves a line priced by discount, and only what changed", async () => {
    const wrapper = await mountEditor()

    await wrapper.find("input[name='discount-i1']").setValue("15")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(callTo("/admin/quote-requests/r1")?.[1]).toEqual({
      method: "PATCH",
      body: { items: [{ id: "i1", discountPct: 15 }] },
    })
    expect(wrapper.emitted("updated")?.[0]).toEqual([quote()])
  })

  it("saves a line priced by hand, the delivery and the validity", async () => {
    const wrapper = await mountEditor()

    await wrapper.find("input[name='price-i1']").setValue("1000")
    await wrapper.find("input[name='shipping']").setValue("30")
    await wrapper.find("input[name='valid-until']").setValue("2026-12-15")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(callTo("/admin/quote-requests/r1")?.[1]).toEqual({
      method: "PATCH",
      body: { items: [{ id: "i1", unitPriceHt: 1000 }], shippingTtc: 30, validUntil: "2026-12-15" },
    })
  })

  it("asks for the documents verdict when a line is of category A, B or C", async () => {
    const wrapper = await mountEditor()

    await wrapper.find("input[name='documents-sufficient']").setValue(true)
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(callTo("/admin/quote-requests/r1")?.[1]).toEqual({ method: "PATCH", body: { documentsSufficient: true } })
    const free = await mountEditor(quote({ requiresDocuments: false }))
    expect(free.find("input[name='documents-sufficient']").exists()).toBe(false)
  })

  it("shows the organisation's documents beside the verdict, and where to review them", async () => {
    const wrapper = await mountEditor()

    const documents = wrapper.find(".org-docs")
    expect(documents.text()).toContain("Agrément d'armurier")
    expect(documents.text()).toContain("Approuvé")
    expect(documents.text()).toContain("Autorisation de commerce (AFCI)")
    expect(documents.text()).toContain("À vérifier")
    expect(documents.find("a[href='/admin/legal-docs']").exists()).toBe(true)

    const none = await mountEditor(quote({ organisationDocuments: [] }))
    expect(none.find(".org-docs").text()).toContain("Aucun justificatif")
  })

  it("sends the quote through Henrri", async () => {
    apiMock.mockResolvedValue({
      data: quote({ sending: true, henrri: { status: "pending", number: null, lastError: null, finalizedAt: null } }),
    })
    const wrapper = await mountEditor()

    await wrapper.find("button.send").trigger("click")
    await flushPromises()

    expect(callTo("/r1/send")?.[1]).toEqual({ method: "POST" })
    expect(wrapper.emitted("updated")).toHaveLength(1)
  })

  it("will not send before the organisation has a billing address, and says where to set it", async () => {
    const wrapper = await mountEditor(
      quote({
        organisation: { ...quote().organisation, billingAddressComplete: false },
      }),
    )

    expect(wrapper.find("button.send").attributes("disabled")).toBeDefined()
    expect(wrapper.text()).toContain("adresse de facturation")
    expect(wrapper.find("a[href='/admin/organisations']").exists()).toBe(true)
  })

  it("locks the quote while Henrri issues it", async () => {
    const wrapper = await mountEditor(
      quote({ sending: true, henrri: { status: "pending", number: null, lastError: null, finalizedAt: null } }),
    )

    expect(wrapper.text()).toContain("Émission en cours")
    expect(wrapper.find("input[name='price-i1']").attributes("disabled")).toBeDefined()
    expect(wrapper.find("button.send").exists()).toBe(false)
  })

  it("says why Henrri refused the quote, and lets SCS fix it and send again", async () => {
    const wrapper = await mountEditor(
      quote({
        henrri: { status: "blocked", number: null, lastError: "TotalMismatch: Henrri 10.00", finalizedAt: null },
      }),
    )

    expect(wrapper.text()).toContain("TotalMismatch")
    expect(wrapper.find("button.send").attributes("disabled")).toBeUndefined()
  })

  it("shows a sent quote read-only, with its Henrri number", async () => {
    const wrapper = await mountEditor(
      quote({
        status: "sent",
        sentAt: "2026-10-25T11:00:00Z",
        totalTtc: 3979.2,
        henrri: { status: "finalized", number: "D-26-10-3", lastError: null, finalizedAt: "2026-10-25T11:00:00Z" },
      }),
    )

    expect(wrapper.text()).toContain("D-26-10-3")
    expect(wrapper.find("form").exists()).toBe(false)
  })
})
