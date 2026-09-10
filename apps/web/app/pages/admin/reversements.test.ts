// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
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
    sharePct: 10,
    baseHt: 500,
    amountHt: 50,
    status: "paid",
    paidAt: "2026-08-25T10:00:00.000Z",
    paidNotes: null,
  },
]

beforeEach(() => {
  apiMock.mockReset()
  apiMock.mockImplementation((url: string) =>
    String(url).includes("/beneficiaries")
      ? Promise.resolve({ data: BENEFICIARIES })
      : Promise.resolve({ data: PAYOUTS }),
  )
})

const mounted = () => mountSuspended(Reversements, { route: "/admin/reversements" })

describe("admin/reversements.vue (story 11.10)", () => {
  it("lists what is owed, with the frozen rate and basis", async () => {
    const wrapper = await mounted()
    const rows = wrapper.findAll("tbody tr")
    expect(rows).toHaveLength(2)
    expect(rows[0]?.text()).toContain("Sylvain")
    expect(rows[0]?.text()).toContain("40 %")
    expect(rows[0]?.text()).toContain("200,00")
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
    const rows = wrapper.findAll("tbody tr")
    expect(rows[0]?.find("button").text()).toContain("Marquer versé")
    expect(rows[1]?.find("button").text()).toContain("Annuler le versement")
  })

  it("sends the status change and reloads", async () => {
    const wrapper = await mounted()
    await wrapper.findAll("tbody tr")[0]?.find("button").trigger("click")
    await flushPromises()

    const call = apiMock.mock.calls.find(([, o]) => (o as { method?: string })?.method === "PATCH")
    expect(call?.[0]).toBe("/admin/finance/payouts/p1")
    expect((call?.[1] as { body: { status: string } }).body.status).toBe("paid")
  })

  it("relays the server's refusal to settle an unpaid sale", async () => {
    const wrapper = await mounted()
    apiMock.mockRejectedValueOnce({
      data: { message: "A pending payout cannot be settled — the sale is not paid, or was refunded" },
    })
    await wrapper.findAll("tbody tr")[0]?.find("button").trigger("click")
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
      .findAll("select")[0]
      ?.findAll("option")
      .map((o) => o.text())
    expect(options).toContain("Sylvain")
    expect(options).toContain("Florian")

    await wrapper.findAll("select")[0]?.setValue("b1")
    await flushPromises()
    // Still both rows: the page did not filter them itself.
    expect(wrapper.findAll("tbody tr")).toHaveLength(2)
  })
})
