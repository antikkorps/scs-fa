import { describe, expect, it } from "vitest"
import {
  aggregateShippingStatus,
  canShipOrder,
  defaultParcelCount,
  findAllocationError,
  type ShipmentItemRef,
  suggestShipmentSplit,
  trackingUrlFor,
} from "./shipping.js"

describe("defaultParcelCount", () => {
  it("presets two parcels for a category B firearm", () => {
    expect(defaultParcelCount("B", "arme-poing")).toBe(2)
    expect(defaultParcelCount("B", "arme-longue")).toBe(2)
  })

  /** Found on the real catalogue: a box of 9×19 is category B, and it is not split. */
  it("keeps category B ammunition, and anything outside category B, in one parcel", () => {
    expect(defaultParcelCount("B", "munition")).toBe(1)
    expect(defaultParcelCount("C", "arme-longue")).toBe(1)
    expect(defaultParcelCount("none", "aide-visee")).toBe(1)
  })
})

const RIFLE = "11111111-1111-4111-8111-111111111111"
const SCOPE = "22222222-2222-4222-8222-222222222222"
const PRINT = "33333333-3333-4333-8333-333333333333"

const item = (variantId: string, part = 1, parts = 1, qty = 1): ShipmentItemRef => ({ variantId, qty, part, parts })

describe("trackingUrlFor", () => {
  it("builds the carrier's tracking link and encodes the number", () => {
    expect(trackingUrlFor("colissimo", "6A 123")).toBe("https://www.laposte.fr/outils/suivre-vos-envois?code=6A%20123")
  })

  it("uses the pasted link for a carrier outside the list", () => {
    expect(trackingUrlFor("other", "X1", "https://suivi.example.fr/X1")).toBe("https://suivi.example.fr/X1")
  })

  /** A pasted link is only honoured for "other": a listed carrier's link is ours to build. */
  it("ignores a pasted link on a listed carrier", () => {
    expect(trackingUrlFor("ups", "1Z9", "https://evil.example/1Z9")).toBe(
      "https://www.ups.com/track?loc=fr_FR&tracknum=1Z9",
    )
  })

  it("returns null without a number, or for an unknown carrier", () => {
    expect(trackingUrlFor("colissimo", null)).toBeNull()
    expect(trackingUrlFor("colissimo", "  ")).toBeNull()
    expect(trackingUrlFor("pigeon", "42")).toBeNull()
  })
})

describe("aggregateShippingStatus", () => {
  const lines = [
    { variantId: RIFLE, qty: 1 },
    { variantId: SCOPE, qty: 2 },
  ]

  it("is unshipped while nothing has left — prepared parcels do not count", () => {
    expect(aggregateShippingStatus(lines, [])).toBe("unshipped")
    expect(aggregateShippingStatus(lines, [{ status: "preparing", items: [item(RIFLE), item(SCOPE, 1, 1, 2)] }])).toBe(
      "unshipped",
    )
  })

  /** The category B case: half a firearm in the post is not a shipped firearm. */
  it("stays partial while only one of the two parcels of a line has left", () => {
    const shipments = [
      { status: "shipped" as const, items: [item(RIFLE, 1, 2), item(SCOPE, 1, 1, 2)] },
      { status: "preparing" as const, items: [item(RIFLE, 2, 2)] },
    ]
    expect(aggregateShippingStatus(lines, shipments)).toBe("partially_shipped")
  })

  it("is partial when a quantity is only partly covered", () => {
    expect(aggregateShippingStatus(lines, [{ status: "shipped", items: [item(RIFLE), item(SCOPE, 1, 1, 1)] }])).toBe(
      "partially_shipped",
    )
  })

  it("is shipped once every unit of every line has left, in all its parts", () => {
    const shipments = [
      { status: "shipped" as const, items: [item(RIFLE, 1, 2)] },
      { status: "delivered" as const, items: [item(RIFLE, 2, 2), item(SCOPE, 1, 1, 2)] },
    ]
    expect(aggregateShippingStatus(lines, shipments)).toBe("shipped")
  })

  it("is delivered only when every parcel is delivered", () => {
    const shipments = [
      { status: "delivered" as const, items: [item(RIFLE, 1, 2)] },
      { status: "delivered" as const, items: [item(RIFLE, 2, 2), item(SCOPE, 1, 1, 2)] },
    ]
    expect(aggregateShippingStatus(lines, shipments)).toBe("delivered")
  })

  it("matches Gun Art lines on their print id", () => {
    expect(
      aggregateShippingStatus(
        [{ printId: PRINT, qty: 1 }],
        [{ status: "shipped", items: [{ printId: PRINT, qty: 1, part: 1, parts: 1 }] }],
      ),
    ).toBe("shipped")
  })
})

describe("findAllocationError", () => {
  const lines = [{ variantId: RIFLE, qty: 1 }]

  it("accepts a parcel that fits what is left to ship", () => {
    expect(findAllocationError(lines, [item(RIFLE, 1, 2)], [item(RIFLE, 2, 2)])).toBeNull()
  })

  it("refuses an article that is not on the order", () => {
    expect(findAllocationError(lines, [], [item(SCOPE)])).toMatch(/not on this order/)
  })

  it("refuses to put more in the post than was bought", () => {
    expect(findAllocationError(lines, [item(RIFLE, 1, 2)], [item(RIFLE, 1, 2)])).toMatch(/more than ordered/)
  })

  it("refuses a part number outside its split", () => {
    expect(findAllocationError(lines, [], [item(RIFLE, 3, 2)])).toMatch(/part/)
  })

  /** Once a line is split in two, a third "1/3" parcel would make the count meaningless. */
  it("refuses a split that contradicts the one already recorded", () => {
    expect(findAllocationError(lines, [item(RIFLE, 1, 2)], [item(RIFLE, 2, 3)])).toMatch(/split/)
  })

  it("refuses the same part twice in one parcel", () => {
    expect(findAllocationError([{ variantId: RIFLE, qty: 3 }], [], [item(RIFLE), item(RIFLE)])).toMatch(/twice/)
  })
})

describe("suggestShipmentSplit", () => {
  const rifle = { variantId: RIFLE, name: "Carabine cat. B", qty: 1, parcelCount: 2 }
  const scope = { variantId: SCOPE, name: "Lunette", qty: 2, parcelCount: 1 }

  it("splits a multi-parcel article and puts the rest in its last parcel", () => {
    expect(suggestShipmentSplit([rifle, scope], [])).toEqual([
      { items: [{ variantId: RIFLE, name: "Carabine cat. B", qty: 1, part: 1, parts: 2 }] },
      {
        items: [
          { variantId: RIFLE, name: "Carabine cat. B", qty: 1, part: 2, parts: 2 },
          { variantId: SCOPE, name: "Lunette", qty: 2, part: 1, parts: 1 },
        ],
      },
    ])
  })

  it("suggests a single parcel when nothing needs splitting", () => {
    expect(suggestShipmentSplit([scope, { printId: PRINT, name: "Tirage", qty: 1, parcelCount: 1 }], [])).toEqual([
      {
        items: [
          { variantId: SCOPE, name: "Lunette", qty: 2, part: 1, parts: 1 },
          { printId: PRINT, name: "Tirage", qty: 1, part: 1, parts: 1 },
        ],
      },
    ])
  })

  it("only suggests what is still to be packed", () => {
    expect(suggestShipmentSplit([rifle, scope], [item(RIFLE, 1, 2), item(SCOPE, 1, 1, 2)])).toEqual([
      { items: [{ variantId: RIFLE, name: "Carabine cat. B", qty: 1, part: 2, parts: 2 }] },
    ])
    expect(suggestShipmentSplit([rifle], [item(RIFLE, 1, 2), item(RIFLE, 2, 2)])).toEqual([])
  })

  /** A split already recorded wins over a parcel count changed on the product since. */
  it("keeps the split already recorded on the order", () => {
    expect(suggestShipmentSplit([{ ...rifle, parcelCount: 3 }], [item(RIFLE, 1, 2)])).toEqual([
      { items: [{ variantId: RIFLE, name: "Carabine cat. B", qty: 1, part: 2, parts: 2 }] },
    ])
  })
})

describe("canShipOrder", () => {
  it("lets a paid order whose dossier is cleared leave", () => {
    expect(canShipOrder({ paymentStatus: "received", legalVerificationStatus: "completed" })).toEqual({ ok: true })
    expect(canShipOrder({ paymentStatus: "partially_refunded", legalVerificationStatus: "docs_verified" })).toEqual({
      ok: true,
    })
  })

  /** `payment_pending` is the resting state of an order that never needed documents. */
  it("does not wait for documents an order never needed", () => {
    expect(canShipOrder({ paymentStatus: "reconciled", legalVerificationStatus: "payment_pending" })).toEqual({
      ok: true,
    })
  })

  it("holds an unpaid order", () => {
    expect(canShipOrder({ paymentStatus: "awaiting_transfer", legalVerificationStatus: "payment_pending" })).toEqual({
      ok: false,
      reason: "unpaid",
    })
    expect(canShipOrder({ paymentStatus: "refunded", legalVerificationStatus: "completed" })).toEqual({
      ok: false,
      reason: "unpaid",
    })
  })

  it("holds a regulated order whose documents are not validated", () => {
    for (const legal of ["pending", "docs_verifying", "docs_rejected"]) {
      expect(canShipOrder({ paymentStatus: "received", legalVerificationStatus: legal })).toEqual({
        ok: false,
        reason: "legal",
      })
    }
  })
})
