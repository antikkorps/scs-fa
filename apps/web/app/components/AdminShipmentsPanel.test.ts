// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AdminOrderDetail, AdminShipment } from "~/types/admin"
import AdminShipmentsPanel from "./AdminShipmentsPanel.vue"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

const RIFLE = "11111111-1111-4111-8111-111111111111"
const SCOPE = "22222222-2222-4222-8222-222222222222"

const parcel = (overrides: Partial<AdminShipment> = {}): AdminShipment => ({
  id: "s1",
  orderId: "o1",
  position: 1,
  carrier: "colissimo",
  carrierLabel: "Colissimo",
  trackingNumber: "6A0001",
  trackingUrl: "https://www.laposte.fr/outils/suivre-vos-envois?code=6A0001",
  status: "preparing",
  shippedAt: null,
  deliveredAt: null,
  notifiedAt: null,
  trackingCheckedAt: null,
  trackingLabel: null,
  notes: null,
  createdAt: "2026-09-13T10:00:00.000Z",
  updatedAt: "2026-09-13T10:00:00.000Z",
  items: [{ id: "i1", variantId: RIFLE, printId: null, label: "Carabine", qty: 1, part: 1, parts: 2 }],
  ...overrides,
})

const order = (overrides: Partial<AdminOrderDetail> = {}) =>
  ({
    id: "o1",
    shippingStatus: "unshipped",
    shipGate: { ok: true },
    shipments: [],
    suggestedParcels: [
      { items: [{ variantId: RIFLE, name: "Carabine", qty: 1, part: 1, parts: 2 }] },
      {
        items: [
          { variantId: RIFLE, name: "Carabine", qty: 1, part: 2, parts: 2 },
          { variantId: SCOPE, name: "Lunette", qty: 2, part: 1, parts: 1 },
        ],
      },
    ],
    ...overrides,
  }) as AdminOrderDetail

const mounted = (o: AdminOrderDetail) => mountSuspended(AdminShipmentsPanel, { props: { order: o } })

const posts = () =>
  apiMock.mock.calls.filter(([, opts]) => (opts as { method?: string })?.method === "POST") as Array<
    [string, { body: { orderId: string; carrier: string; items: unknown[] } }]
  >

beforeEach(() => {
  apiMock.mockReset()
  apiMock.mockResolvedValue({ data: {} })
})

describe("AdminShipmentsPanel (story 11.9)", () => {
  it("starts from the suggested split and packs it, one call per parcel", async () => {
    const wrapper = await mounted(order())
    await wrapper.find(".pack-open").trigger("click")
    expect(wrapper.findAll(".draft")).toHaveLength(2)

    await wrapper.find(".pack-submit").trigger("click")
    await flushPromises()

    const calls = posts()
    expect(calls).toHaveLength(2)
    expect(calls[0]?.[0]).toBe("/admin/shipments")
    expect(calls[0]?.[1].body).toMatchObject({
      orderId: "o1",
      carrier: "colissimo",
      items: [{ variantId: RIFLE, qty: 1, part: 1, parts: 2 }],
    })
    expect(calls[1]?.[1].body.items).toHaveLength(2)
    expect(wrapper.emitted("changed")).toBeTruthy()
  })

  /** Emptying a line takes it out of that parcel: it will simply be suggested again. */
  it("leaves out what the admin emptied, and never posts an empty parcel", async () => {
    const wrapper = await mounted(order())
    await wrapper.find(".pack-open").trigger("click")
    const drafts = wrapper.findAll(".draft")
    await drafts[0]?.find(".draft__qty").setValue(0)
    await drafts[1]?.findAll(".draft__qty")[1]?.setValue(0)

    await wrapper.find(".pack-submit").trigger("click")
    await flushPromises()

    const calls = posts()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[1].body.items).toEqual([{ variantId: RIFLE, qty: 1, part: 2, parts: 2 }])
  })

  it("shows what each parcel holds and links to its tracking", async () => {
    const wrapper = await mounted(order({ shipments: [parcel({ status: "shipped" })], suggestedParcels: [] }))
    expect(wrapper.text()).toContain("Carabine (partie 1/2)")
    const link = wrapper.find('a[href^="https://www.laposte.fr"]')
    expect(link.exists()).toBe(true)
    expect(link.attributes("rel")).toContain("noopener")
    expect(wrapper.find(".pack-open").exists()).toBe(false)
  })

  it("says why nothing can leave yet, and does not offer to ship", async () => {
    const wrapper = await mounted(order({ shipGate: { ok: false, reason: "legal" }, shipments: [parcel()] }))
    expect(wrapper.text()).toContain("documents légaux")
    expect(wrapper.find(".ship-btn").attributes("disabled")).toBeDefined()
  })

  /** Story 11.9b — pickup is not offered; a pickup order must not read as "nothing to ship". */
  it("says an order is collected in store rather than pretending it has nothing to ship", async () => {
    const wrapper = await mounted(order({ shipGate: { ok: false, reason: "pickup" }, suggestedParcels: [] }))
    expect(wrapper.text()).toContain("retirer en armurerie")
    expect(wrapper.text()).not.toContain("Aucun article à expédier")
    expect(wrapper.find(".pack-open").exists()).toBe(false)
  })

  /** Story 11.9b — automatic tracking, and its honest failure mode. */
  describe("carrier tracking", () => {
    it("shows the carrier's own words about a parcel on its way", async () => {
      const wrapper = await mounted(
        order({
          shipments: [
            parcel({
              status: "shipped",
              trackingLabel: "Votre colis est arrivé sur la plateforme de distribution.",
              trackingCheckedAt: "2026-09-16T08:00:00.000Z",
            }),
          ],
          suggestedParcels: [],
        }),
      )
      expect(wrapper.text()).toContain("Votre colis est arrivé sur la plateforme de distribution.")
      expect(wrapper.text()).toContain("transporteur interrogé le")
    })

    it("asks the carrier on demand", async () => {
      const wrapper = await mounted(order({ shipments: [parcel({ status: "shipped" })], suggestedParcels: [] }))
      await wrapper.find(".track-btn").trigger("click")
      await flushPromises()

      const call = apiMock.mock.calls.find(([url]) => String(url).endsWith("/refresh-tracking"))
      expect(call?.[0]).toBe("/admin/shipments/s1/refresh-tracking")
      expect((call?.[1] as { method: string }).method).toBe("POST")
    })

    /** A button that silently does nothing is worse than one that explains itself. */
    it("relays the server's explanation when no carrier can be asked", async () => {
      const wrapper = await mounted(order({ shipments: [parcel({ status: "shipped" })], suggestedParcels: [] }))
      apiMock.mockRejectedValueOnce({
        data: { message: "Automatic tracking is not available for this parcel — mark it delivered by hand" },
      })

      await wrapper.find(".track-btn").trigger("click")
      await flushPromises()
      expect(wrapper.find(".alert").text()).toContain("mark it delivered by hand")
    })

    it("offers no tracking refresh on a parcel that has not left", async () => {
      const wrapper = await mounted(order({ shipments: [parcel({ status: "preparing" })], suggestedParcels: [] }))
      expect(wrapper.find(".track-btn").exists()).toBe(false)
    })
  })

  it("marks a parcel shipped, and relays the server's refusal instead of failing silently", async () => {
    const wrapper = await mounted(order({ shipments: [parcel()] }))
    apiMock.mockRejectedValueOnce({ data: { message: "A tracking number is required to ship with Colissimo" } })

    await wrapper.find(".ship-btn").trigger("click")
    await flushPromises()

    const patch = apiMock.mock.calls.find(([, o]) => (o as { method?: string })?.method === "PATCH")
    expect(patch?.[0]).toBe("/admin/shipments/s1")
    expect((patch?.[1] as { body: unknown }).body).toEqual({ status: "shipped" })
    expect(wrapper.find(".alert").text()).toContain("tracking number is required")
    expect(wrapper.emitted("changed")).toBeFalsy()
  })

  /** A parcel that has left is a fact: it can be corrected, not deleted. */
  it("only offers to delete a parcel still being prepared", async () => {
    const preparing = await mounted(order({ shipments: [parcel()] }))
    expect(preparing.find(".delete-btn").exists()).toBe(true)

    const shipped = await mounted(order({ shipments: [parcel({ status: "shipped" })] }))
    expect(shipped.find(".delete-btn").exists()).toBe(false)
    expect(shipped.find(".deliver-btn").exists()).toBe(true)
  })
})
