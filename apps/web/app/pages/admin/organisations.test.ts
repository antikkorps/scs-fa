// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AdminOrganisationDetail, AdminOrganisationRow } from "~/types/organisation"
import Organisations from "./organisations.vue"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

const MEMBER = { id: "u1", email: "jeanne@armurerie.fr", firstName: "Jeanne", lastName: "Armand" }
const ROW: AdminOrganisationRow = {
  id: "o1",
  legalName: "Armurerie Armand",
  siret: "73282932000074",
  type: "armurier",
  status: "pending",
  registryCheck: "unavailable",
  createdAt: "2026-10-21T10:00:00Z",
  member: MEMBER,
}
const DETAIL: AdminOrganisationDetail = {
  ...ROW,
  registrySnapshot: null,
  registryCheckedAt: "2026-10-21T10:00:00Z",
  reviewedAt: null,
  reviewReason: null,
  discountPct: 0,
  net30Allowed: false,
  showPrices: false,
  updatedAt: "2026-10-21T10:00:00Z",
}
const PAGINATION = { page: 1, limit: 20, total: 1, totalPages: 1, hasMore: false }

// Routes the mocked API by URL, so list refreshes and detail loads answer in any order.
function serve(detail: AdminOrganisationDetail) {
  // The admin middleware's redirect to the login screen calls it too, without a URL.
  apiMock.mockImplementation(async (url: string | undefined, options?: { method?: string }) => {
    if (url?.startsWith("/admin/organisations?"))
      return { data: [{ ...ROW, status: detail.status, type: detail.type }], pagination: PAGINATION }
    if (url === `/admin/organisations/${detail.id}` && !options?.method) return { data: detail }
    return { data: detail }
  })
}

async function openFirst() {
  const wrapper = await mountSuspended(Organisations, { route: "/admin/organisations" })
  await flushPromises()
  await wrapper.find("tbody tr").trigger("click")
  await flushPromises()
  return wrapper
}

const callsTo = (suffix: string) => apiMock.mock.calls.filter(([url]) => String(url).endsWith(suffix))

beforeEach(() => {
  apiMock.mockReset()
})

describe("admin/organisations.vue (story 12.8b)", () => {
  it("lists pending requests first, with what the registry said", async () => {
    serve(DETAIL)
    const wrapper = await mountSuspended(Organisations, { route: "/admin/organisations" })
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith("/admin/organisations?status=pending&page=1&limit=20")
    const line = wrapper.find("tbody tr").text()
    expect(line).toContain("Armurerie Armand")
    expect(line).toContain("jeanne@armurerie.fr")
    expect(line).toContain("Registre injoignable")
  })

  it("approves a request with the terms SCS set", async () => {
    serve(DETAIL)
    const wrapper = await openFirst()
    expect(
      wrapper.find('.drawer a[href="https://annuaire-entreprises.data.gouv.fr/etablissement/73282932000074"]').exists(),
    ).toBe(true)

    await wrapper.find('input[name="discountPct"]').setValue("12.5")
    await wrapper.find('input[name="showPrices"]').setValue(true)
    await wrapper.find("button.approve").trigger("click")
    await flushPromises()

    expect(callsTo("/o1/approve")[0]?.[1]).toEqual({
      method: "POST",
      body: { discountPct: 12.5, net30Allowed: false, showPrices: true },
    })
  })

  it("offers administrations the 30-day payment by default", async () => {
    serve({ ...DETAIL, type: "administration" })
    const wrapper = await openFirst()
    expect((wrapper.find('input[name="net30Allowed"]').element as HTMLInputElement).checked).toBe(true)
  })

  it("asks for a reason before refusing", async () => {
    serve(DETAIL)
    const wrapper = await openFirst()

    await wrapper.find("button.reject").trigger("click")
    await wrapper.find("form.reason-form").trigger("submit")
    await flushPromises()
    expect(callsTo("/o1/reject")).toHaveLength(0)
    expect(wrapper.text()).toContain("Indiquez le motif")

    await wrapper.find("textarea[name='reason']").setValue("Établissement fermé")
    await wrapper.find("form.reason-form").trigger("submit")
    await flushPromises()
    expect(callsTo("/o1/reject")[0]?.[1]).toEqual({ method: "POST", body: { reason: "Établissement fermé" } })
  })

  it("saves the terms of an approved account and suspends it with a reason", async () => {
    serve({ ...DETAIL, status: "approved", registryCheck: "verified" })
    const wrapper = await openFirst()

    await wrapper.find('input[name="discountPct"]').setValue("8")
    await wrapper.find("button.save-terms").trigger("click")
    await flushPromises()
    expect(callsTo("/admin/organisations/o1").find(([, options]) => options?.method === "PATCH")?.[1]).toEqual({
      method: "PATCH",
      body: { discountPct: 8, net30Allowed: false, showPrices: false },
    })

    await wrapper.find("button.suspend").trigger("click")
    await wrapper.find("textarea[name='reason']").setValue("Impayés")
    await wrapper.find("form.reason-form").trigger("submit")
    await flushPromises()
    expect(callsTo("/o1/suspend")[0]?.[1]).toEqual({ method: "POST", body: { reason: "Impayés" } })
  })

  it("reinstates a suspended account", async () => {
    serve({ ...DETAIL, status: "suspended", reviewReason: "Impayés" })
    const wrapper = await openFirst()
    expect(wrapper.find(".drawer").text()).toContain("Impayés")

    await wrapper.find("button.reinstate").trigger("click")
    await flushPromises()
    expect(callsTo("/o1/reinstate")[0]?.[1]).toEqual({ method: "POST" })
  })
})
