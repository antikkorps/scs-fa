// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AdminQuoteRequestDetail, AdminQuoteRequestRow } from "~/types/quote"
import Devis from "./devis.vue"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

const ROW: AdminQuoteRequestRow = {
  id: "r1",
  number: "DR-2026-0001",
  status: "requested",
  message: "Livraison au poste",
  validUntil: null,
  createdAt: "2026-10-21T10:00:00Z",
  updatedAt: "2026-10-21T10:00:00Z",
  lineCount: 1,
  organisation: { id: "o1", legalName: "Police municipale de Lyon", type: "administration" },
  requester: { id: "u1", email: "agent@lyon.fr", firstName: "Jeanne", lastName: "Armand" },
}
const DETAIL: AdminQuoteRequestDetail = {
  ...ROW,
  organisation: {
    id: "o1",
    legalName: "Police municipale de Lyon",
    siret: "21690123100011",
    type: "administration",
    status: "approved",
    discountPct: 12,
    net30Allowed: true,
    showPrices: false,
    billingAddress: { line1: "1 place de la Comédie", line2: null, postal: "69001", city: "Lyon", country: "FR" },
    billingAddressComplete: true,
  },
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
      publicPriceHt: 405,
      vatPct: 20,
      quotedPriceHt: null,
      lineDiscountPct: null,
    },
  ],
  sentAt: null,
  shippingTtc: 0,
  totals: null,
  totalTtc: null,
  requiresDocuments: false,
  documentsSufficient: null,
  henrri: null,
  sending: false,
}
const PAGINATION = { page: 1, limit: 20, total: 1, totalPages: 1, hasMore: false }

function serve(detail: AdminQuoteRequestDetail) {
  // The admin middleware's redirect to the login screen calls it too, without a URL.
  apiMock.mockImplementation(async (url: string | undefined) => {
    if (url?.startsWith("/admin/quote-requests?"))
      return { data: [{ ...ROW, status: detail.status }], pagination: PAGINATION }
    return { data: detail }
  })
}

async function openFirst() {
  const wrapper = await mountSuspended(Devis, { route: "/admin/devis" })
  await flushPromises()
  await wrapper.find("tbody tr").trigger("click")
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  apiMock.mockReset()
})

describe("admin/devis.vue (story 12.8c)", () => {
  it("lists the new requests first, with their organisation", async () => {
    serve(DETAIL)
    const wrapper = await mountSuspended(Devis, { route: "/admin/devis" })
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith("/admin/quote-requests?status=requested&page=1&limit=20")
    const line = wrapper.find("tbody tr").text()
    expect(line).toContain("DR-2026-0001")
    expect(line).toContain("Police municipale de Lyon")
    expect(line).toContain("Envoyée")
  })

  it("shows the lines with the public price they start from, and the organisation's terms", async () => {
    serve(DETAIL)
    const drawer = (await openFirst()).find(".drawer")
    expect(drawer.text()).toContain("Gilet niveau IIIA")
    expect(drawer.text()).toMatch(/405,00\s?€/)
    expect(drawer.text()).toMatch(/4\s?860,00\s?€/)
    expect(drawer.text()).toMatch(/12\s?%/)
    expect(drawer.text()).toContain("Paiement à 30 jours autorisé")
    expect(drawer.text()).toContain("Livraison au poste")
  })

  it("takes a request in hand, then reloads it to show the quote it starts", async () => {
    serve(DETAIL)
    const wrapper = await openFirst()
    await wrapper.find("button.take").trigger("click")
    await flushPromises()
    const call = apiMock.mock.calls.find(([url]) => String(url).endsWith("/r1/review"))
    expect(call?.[1]).toEqual({ method: "POST" })
    expect(apiMock.mock.calls.filter(([url]) => url === "/admin/quote-requests/r1")).toHaveLength(2)
  })

  // Story 12.8d — once in hand, SCS prices the quote.
  it("shows the quote editor once in hand", async () => {
    serve({
      ...DETAIL,
      status: "in_review",
      items: DETAIL.items.map((item) => ({ ...item, quotedPriceHt: 356.4, lineDiscountPct: 12 })),
    })
    const wrapper = await openFirst()
    expect(wrapper.find("button.take").exists()).toBe(false)
    expect(wrapper.find("input[name='price-i1']").exists()).toBe(true)
  })

  it("offers a tab for the sent quotes", async () => {
    serve(DETAIL)
    const wrapper = await mountSuspended(Devis, { route: "/admin/devis" })
    await flushPromises()
    const sent = wrapper.findAll(".tab").find((tab) => tab.text() === "Envoyés")
    await sent?.trigger("click")
    expect(sent?.attributes("aria-pressed")).toBe("true")
  })
})
