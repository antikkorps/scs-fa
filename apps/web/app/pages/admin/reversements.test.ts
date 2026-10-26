// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Reversements from "./reversements.vue"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

const BENEFICIARIES = [
  { id: "b1", name: "Sylvain", kind: "artist", defaultSharePct: 40, dueHt: 200, paidHt: 0, pendingHt: 0, active: true },
  {
    id: "b2",
    name: "Florian",
    kind: "advisor",
    defaultSharePct: 10,
    dueHt: 0,
    paidHt: 50,
    pendingHt: 30,
    active: true,
  },
]

const PAYOUTS = [
  {
    id: "p1",
    orderId: "o1",
    orderPlacedAt: "2026-09-01T10:00:00.000Z",
    beneficiaryId: "b1",
    beneficiaryName: "Sylvain",
    label: "Éclat de Bronze 1/25",
    sharePct: 40,
    baseHt: 500,
    amountHt: 200,
    status: "due",
    paidAt: null,
    paidNotes: null,
  },
  {
    id: "p2",
    orderId: "o2",
    orderPlacedAt: "2026-08-20T10:00:00.000Z",
    beneficiaryId: "b2",
    beneficiaryName: "Florian",
    label: "Carabine",
    sharePct: 12.5,
    baseHt: 400,
    amountHt: 50,
    status: "paid",
    paidAt: "2026-08-25T10:00:00.000Z",
    paidNotes: null,
  },
]

const SUMMARY = [{ beneficiaryId: "b2", name: "Florian", paidCount: 2, paidHt: 150, dueHt: 0, pendingHt: 30 }]

beforeEach(() => {
  apiMock.mockReset()
  apiMock.mockImplementation((url: string) => {
    if (String(url).includes("/beneficiaries")) return Promise.resolve({ data: BENEFICIARIES })
    if (String(url).includes("/payouts/summary")) return Promise.resolve({ data: SUMMARY })
    if (String(url).includes("/payouts/export")) return Promise.resolve(new Blob(["csv"]))
    return Promise.resolve({ data: PAYOUTS })
  })
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-26T10:00:00Z") })
})

afterEach(() => {
  vi.useRealTimers()
})

const mounted = () => mountSuspended(Reversements, { route: "/admin/reversements" })

describe("admin/reversements.vue (story 11.10)", () => {
  it("lists what is owed, with the frozen rate and basis", async () => {
    const wrapper = await mounted()
    const rows = wrapper.findAll(".payouts tbody tr")
    expect(rows).toHaveLength(2)
    expect(rows[0]?.text()).toContain("Sylvain")
    expect(rows[0]?.text().replace(/\s/g, " ")).toContain("40 %")
    expect(rows[0]?.text()).toContain("200,00")
  })

  it("writes a fractional rate with a decimal comma", async () => {
    const wrapper = await mounted()
    const secondRow = wrapper.findAll(".payouts tbody tr")[1]?.text() ?? ""
    expect(secondRow.replace(/\s/g, " ")).toContain("12,5 %")
  })

  it("says the figures were frozen at the sale, rather than leaving it to be guessed", async () => {
    const wrapper = await mounted()
    expect(wrapper.text()).toContain("figés à la commande")
  })

  it("totals only what is actually due, not what is merely expected", async () => {
    const wrapper = await mounted()
    // 200 due + 50 already paid → only the 200 counts.
    expect(wrapper.find(".total").text()).toContain("200,00")
  })

  it("offers to settle a due payout, and to undo a settled one", async () => {
    const wrapper = await mounted()
    const rows = wrapper.findAll(".payouts tbody tr")
    expect(rows[0]?.find("button").text()).toContain("Marquer versé")
    expect(rows[1]?.find("button").text()).toContain("Annuler le versement")
  })

  it("sends the status change and reloads", async () => {
    const wrapper = await mounted()
    await wrapper.findAll(".payouts tbody tr")[0]?.find("button").trigger("click")
    await flushPromises()

    const call = apiMock.mock.calls.find(([, o]) => (o as { method?: string })?.method === "PATCH")
    expect(call?.[0]).toBe("/admin/finance/payouts/p1")
    expect((call?.[1] as { body: { status: string } } | undefined)?.body.status).toBe("paid")
  })

  it("relays the server's refusal to settle an unpaid sale", async () => {
    const wrapper = await mounted()
    apiMock.mockRejectedValueOnce({
      data: { message: "A pending payout cannot be settled — the sale is not paid, or was refunded" },
    })
    await wrapper.findAll(".payouts tbody tr")[0]?.find("button").trigger("click")
    await flushPromises()
    expect(wrapper.find(".alert").text()).toContain("not paid")
  })

  /**
   * The filter is delegated to the API, never applied to the array in the page:
   * the list is capped server-side, so filtering locally would quietly hide rows
   * beyond the cap. (The refetch itself is `useAsyncData`'s watcher, exercised
   * in the browser — its key cache makes it a no-op under test.)
   */
  it("builds the beneficiary filter from the API and never filters client-side", async () => {
    const wrapper = await mounted()
    const options = wrapper
      .find(".filters select")
      ?.findAll("option")
      .map((o) => o.text())
    expect(options).toContain("Sylvain")
    expect(options).toContain("Florian")

    await wrapper.find(".filters select").setValue("b1")
    await flushPromises()
    // Still both rows: the page did not filter them itself.
    expect(wrapper.findAll(".payouts tbody tr")).toHaveLength(2)
  })
})

describe("admin/reversements.vue — accounting export", () => {
  const exportCalls = () => apiMock.mock.calls.filter(([url]) => String(url).includes("/payouts/export"))

  it("proposes last month, and sums it per beneficiary", async () => {
    const wrapper = await mounted()
    await flushPromises()
    const days = wrapper.findAll<HTMLInputElement>(".export input[type=date]").map((input) => input.element.value)
    expect(days).toEqual(["2026-09-01", "2026-09-30"])
    expect(apiMock).toHaveBeenCalledWith("/admin/finance/payouts/summary", {
      query: { from: "2026-09-01", to: "2026-09-30" },
    })
    const line = wrapper.find(".export tbody tr").text()
    expect(line).toContain("Florian")
    expect(line).toContain("150,00")
    expect(line).toContain("30,00")
  })

  it("downloads the CSV for the period and the chosen beneficiary", async () => {
    const createObjectURL = vi.fn(() => "blob:csv")
    const { createObjectURL: realCreate, revokeObjectURL: realRevoke } = URL
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = vi.fn()
    // The download link's click would navigate the test window to the blob.
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    const wrapper = await mounted()
    await wrapper.find(".export select").setValue("b2")
    await wrapper.find(".export .download").trigger("click")
    await flushPromises()
    expect(exportCalls()[0]).toEqual([
      "/admin/finance/payouts/export",
      { responseType: "blob", query: { from: "2026-09-01", to: "2026-09-30", beneficiaryId: "b2" } },
    ])
    expect(createObjectURL).toHaveBeenCalled()
    expect(click).toHaveBeenCalled()
    click.mockRestore()
    URL.createObjectURL = realCreate
    URL.revokeObjectURL = realRevoke
  })

  it("refuses a period that ends before it starts, without calling the API", async () => {
    const wrapper = await mounted()
    await wrapper.findAll(".export input[type=date]")[1]?.setValue("2026-08-01")
    await wrapper.find(".export .download").trigger("click")
    await flushPromises()
    expect(exportCalls()).toHaveLength(0)
    expect(wrapper.find(".export [role=alert]").text()).toContain("avant")
  })
})
