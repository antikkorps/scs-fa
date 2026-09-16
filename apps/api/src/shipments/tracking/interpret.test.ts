import { describe, expect, it } from "vitest"
import { interpretLaPosteShipment, interpretMondialRelayTracing } from "./interpret.js"

describe("interpretLaPosteShipment", () => {
  it("takes the delivery date the carrier commits to", () => {
    const result = interpretLaPosteShipment({
      isFinal: true,
      deliveryDate: "2026-09-12T14:32:00+02:00",
      event: [{ code: "LIVCFM", label: "Votre colis est livré.", date: "2026-09-12T14:32:00+02:00" }],
    })
    expect(result.state).toBe("delivered")
    expect(result.label).toBe("Votre colis est livré.")
    expect(result.deliveredAt?.toISOString()).toBe("2026-09-12T12:32:00.000Z")
  })

  it("accepts a delivered event code when no delivery date came with it", () => {
    const result = interpretLaPosteShipment({
      deliveryDate: null,
      event: [{ code: "DI1", label: "Colis distribué", date: "2026-09-12T09:00:00Z" }],
    })
    expect(result.state).toBe("delivered")
    expect(result.deliveredAt?.toISOString()).toBe("2026-09-12T09:00:00.000Z")
  })

  /** Some responses name the field `status` instead of `code`. */
  it("reads the event code under either of its two names", () => {
    expect(interpretLaPosteShipment({ event: [{ status: "livcfm", label: "Livré" }] }).state).toBe("delivered")
  })

  /**
   * ⚠️ The single most expensive mistake this file could make: a parcel waiting
   * on a shelf in a pickup point has NOT reached its addressee.
   */
  it("does not call a parcel waiting at a pickup point delivered", () => {
    const result = interpretLaPosteShipment({
      deliveryDate: null,
      event: [{ code: "AARBPR", label: "Votre colis est à disposition au bureau de poste." }],
    })
    expect(result.state).toBe("in_transit")
    expect(result.deliveredAt).toBeNull()
  })

  it("reports a travelling parcel, keeping the carrier's own words", () => {
    const result = interpretLaPosteShipment({
      event: [{ code: "PCHTRI", label: "Votre colis est en cours de transport." }],
    })
    expect(result).toEqual({
      state: "in_transit",
      label: "Votre colis est en cours de transport.",
      deliveredAt: null,
    })
  })

  it("falls back to the timeline when there is no event list", () => {
    const result = interpretLaPosteShipment({
      timeline: [
        { shortLabel: "Pris en charge", status: true },
        { shortLabel: "En cours d'acheminement", status: true },
        { shortLabel: "Livré", status: false },
      ],
    })
    expect(result).toEqual({ state: "in_transit", label: "En cours d'acheminement", deliveredAt: null })
  })

  it("says nothing rather than something wrong on an empty or missing payload", () => {
    expect(interpretLaPosteShipment(undefined)).toEqual({ state: "unknown", label: null, deliveredAt: null })
    expect(interpretLaPosteShipment({})).toEqual({ state: "unknown", label: null, deliveredAt: null })
  })

  it("ignores an unparsable delivery date instead of inventing one", () => {
    const result = interpretLaPosteShipment({
      deliveryDate: "pas une date",
      event: [{ code: "PCHTRI", label: "En route" }],
    })
    expect(result.state).toBe("in_transit")
    expect(result.deliveredAt).toBeNull()
  })
})

describe("interpretMondialRelayTracing", () => {
  it("reads a delivery from the label and dates it from the day and hour", () => {
    const result = interpretMondialRelayTracing([
      { label: "Prise en charge par Mondial Relay", date: "10/09/2026", hour: "08:12" },
      { label: "Colis livré", date: "12/09/2026", hour: "14:32" },
    ])
    expect(result.state).toBe("delivered")
    expect(result.label).toBe("Colis livré")
    expect(result.deliveredAt?.getFullYear()).toBe(2026)
    expect(result.deliveredAt?.getMonth()).toBe(8) // September
    expect(result.deliveredAt?.getDate()).toBe(12)
    expect(result.deliveredAt?.getHours()).toBe(14)
  })

  /**
   * ⚠️ The trap of matching French free text: "livraison" must never be read as
   * "livré". A parcel out for delivery has not been delivered.
   */
  it("does not mistake a parcel out for delivery for a delivered one", () => {
    for (const label of [
      "En cours de livraison",
      "Mise en livraison",
      "Livraison prévue aujourd'hui",
      "Prêt pour livraison",
    ]) {
      const result = interpretMondialRelayTracing([{ label, date: "12/09/2026", hour: "09:00" }])
      expect(result.state, label).toBe("in_transit")
      expect(result.deliveredAt, label).toBeNull()
    }
  })

  it("recognises the wordings that do mean delivered", () => {
    for (const label of [
      "Colis livré",
      "Colis livrée au point relais",
      "Remis au destinataire",
      "Retiré par le destinataire",
    ]) {
      expect(interpretMondialRelayTracing([{ label, date: "12/09/2026" }]).state, label).toBe("delivered")
    }
  })

  it("only ever looks at the latest entry", () => {
    const result = interpretMondialRelayTracing([
      { label: "Colis livré au point relais", date: "10/09/2026" },
      { label: "En cours de livraison", date: "12/09/2026" },
    ])
    expect(result.state).toBe("in_transit")
  })

  it("dates a delivery it cannot parse to now rather than losing it", () => {
    const result = interpretMondialRelayTracing([{ label: "Colis livré" }])
    expect(result.state).toBe("delivered")
    expect(result.deliveredAt).toBeInstanceOf(Date)
  })

  it("says nothing on an empty tracing table", () => {
    expect(interpretMondialRelayTracing([])).toEqual({ state: "unknown", label: null, deliveredAt: null })
  })
})
