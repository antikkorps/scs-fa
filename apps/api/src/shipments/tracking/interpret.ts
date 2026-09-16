import type { TrackingResult } from "./types.js"

// The only place that decides "this parcel arrived". Pure and tested on its own,
// because it is the one rule whose mistake is expensive: a wrong "delivered"
// closes an order the customer never received.

/** Parse a carrier date, keeping `null` for anything we cannot read. */
function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

// --- La Poste / Colissimo / Chronopost -------------------------------------

/**
 * Event codes that mean the parcel reached its addressee.
 *
 * Deliberately short: `deliveryDate` below is the primary signal, and this list
 * only catches a delivery the payload states without dating it. ⚠️ `AARBPR`
 * ("mis à disposition en point de retrait") is NOT here — waiting on a shelf is
 * not delivered.
 */
export const LAPOSTE_DELIVERED_EVENT_CODES: readonly string[] = ["LIVCFM", "DI1", "DI2"]

interface LaPosteEvent {
  /** The v2 payload names this `code`; some responses carry it as `status`. */
  code?: string
  status?: string
  label?: string
  date?: string
}

export interface LaPosteShipment {
  isFinal?: boolean
  deliveryDate?: string | null
  event?: LaPosteEvent[]
  timeline?: Array<{ shortLabel?: string; status?: boolean; date?: string }>
}

/**
 * Read a La Poste "Suivi v2" shipment.
 *
 * Events come newest-first in the v2 payload, so the head of the list is the
 * current state. Delivery is taken from `deliveryDate` first — a date the
 * carrier commits to — and only then from a known delivered event code.
 */
export function interpretLaPosteShipment(shipment: LaPosteShipment | undefined | null): TrackingResult {
  if (!shipment) return { state: "unknown", label: null, deliveredAt: null }

  const events = shipment.event ?? []
  const latest = events[0]
  const label =
    latest?.label?.trim() ||
    shipment.timeline
      ?.filter((t) => t.status)
      .at(-1)
      ?.shortLabel?.trim() ||
    null

  const deliveryDate = parseDate(shipment.deliveryDate)
  const code = (latest?.code ?? latest?.status)?.trim().toUpperCase()
  const deliveredByCode = code !== undefined && LAPOSTE_DELIVERED_EVENT_CODES.includes(code)

  if (deliveryDate) return { state: "delivered", label, deliveredAt: deliveryDate }
  // Delivered but undated: fall back to the event's own date, then to now.
  if (deliveredByCode) return { state: "delivered", label, deliveredAt: parseDate(latest?.date) ?? new Date() }

  return { state: events.length > 0 || shipment.timeline?.length ? "in_transit" : "unknown", label, deliveredAt: null }
}

// --- Mondial Relay ---------------------------------------------------------

/**
 * ⚠️ Mondial Relay's tracing web service returns FREE-TEXT French labels, not
 * normalised status codes — so "delivered" has to be read rather than looked up.
 *
 * The positive pattern only matches the past participle ("livré", "livrée",
 * "livrés"): "livraison" cannot match it, since `[ée]` never matches the `a` of
 * "livrai-". ⚠️ It ends on a negative lookahead rather than `\b`, because
 * JavaScript's `\b` is ASCII-only — it sees NO word boundary after the `é` of
 * "livré", so `/livr[ée]\b/` silently never matches. The negative pattern is
 * belt-and-braces for wordings such as "en cours de livraison" and is checked
 * first, so a future rewording on their side fails towards "still travelling"
 * rather than towards a false delivery.
 */
const MR_NOT_DELIVERED = /en cours de livraison|mise en livraison|pr[êe]te? (?:pour|à)|disponible/i
const MR_DELIVERED = /\blivr[ée]{1,2}s?(?![a-zà-ÿ])|remis au destinataire|retir[ée]e? par le destinataire/i

export interface MondialRelayEvent {
  label: string
  /** Day and time as the service reports them, e.g. "12/09/2026" and "14:32". */
  date?: string
  hour?: string
}

/** Combine Mondial Relay's separate day and time fields into one instant. */
function parseMondialRelayDate(event: MondialRelayEvent): Date | null {
  const [day, month, year] = (event.date ?? "").split("/")
  if (!day || !month || !year) return null
  const [hours = "0", minutes = "0"] = (event.hour ?? "").split(":")
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes))
  return Number.isNaN(date.getTime()) ? null : date
}

/** Read a Mondial Relay tracing table. Entries come oldest-first. */
export function interpretMondialRelayTracing(events: MondialRelayEvent[]): TrackingResult {
  const latest = events.at(-1)
  if (!latest) return { state: "unknown", label: null, deliveredAt: null }

  const label = latest.label.trim() || null
  const delivered = !MR_NOT_DELIVERED.test(latest.label) && MR_DELIVERED.test(latest.label)
  if (!delivered) return { state: "in_transit", label, deliveredAt: null }
  return { state: "delivered", label, deliveredAt: parseMondialRelayDate(latest) ?? new Date() }
}
