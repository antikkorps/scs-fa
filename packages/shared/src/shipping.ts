import { PAID_PAYMENT_STATUSES } from "./orders.js"

// Story 11.9 — multi-parcel shipping. Everything here is pure: the API persists
// and the admin screen previews with the very same rules.

/** One parcel's life. `preparing` is packed but not handed to the carrier yet. */
export const SHIPMENT_STATUSES = ["preparing", "shipped", "delivered"] as const
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number]

/** The order-level view, derived from its parcels — never set by hand. */
export const ORDER_SHIPPING_STATUSES = ["unshipped", "partially_shipped", "shipped", "delivered"] as const
export type OrderShippingStatus = (typeof ORDER_SHIPPING_STATUSES)[number]

/** Upper bound on how many parcels a single article can be split across. */
export const MAX_PARCELS_PER_ARTICLE = 5

/** Product categories that hold firearms — as opposed to ammunition, optics or accessories. */
export const FIREARM_CATEGORY_SLUGS: readonly string[] = ["arme-poing", "arme-longue", "arme-defense"]

/**
 * The parcel count preset on a new product. A category B FIREARM is delivered in
 * two parcels (weapon and parts apart); category B ammunition travels whole.
 * Only a preset: the admin can change it article by article.
 */
export function defaultParcelCount(legalCategory: string, categorySlug: string): number {
  return legalCategory === "B" && FIREARM_CATEGORY_SLUGS.includes(categorySlug) ? 2 : 1
}

/**
 * Closed list of carriers. Adding one is a code change, not a migration: the
 * database stores the code as plain text and the API refuses unknown codes.
 *
 * `trackingUrl` is a template where `{number}` is replaced by the URL-encoded
 * tracking number. `other` has none: the admin pastes the full link instead.
 */
export const SHIPPING_CARRIERS = [
  {
    code: "colissimo",
    label: "Colissimo",
    trackingUrl: "https://www.laposte.fr/outils/suivre-vos-envois?code={number}",
  },
  {
    code: "chronopost",
    label: "Chronopost",
    trackingUrl: "https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT={number}",
  },
  {
    code: "dhl",
    label: "DHL Express",
    trackingUrl: "https://www.dhl.com/fr-fr/home/tracking/tracking-express.html?submit=1&tracking-id={number}",
  },
  { code: "ups", label: "UPS", trackingUrl: "https://www.ups.com/track?loc=fr_FR&tracknum={number}" },
  { code: "dpd", label: "DPD", trackingUrl: "https://www.dpd.fr/trace/{number}" },
  { code: "gls", label: "GLS", trackingUrl: "https://gls-group.com/FR/fr/suivi-colis?match={number}" },
  { code: "other", label: "Autre transporteur", trackingUrl: null },
] as const

export type ShippingCarrierCode = (typeof SHIPPING_CARRIERS)[number]["code"]

export const SHIPPING_CARRIER_CODES = SHIPPING_CARRIERS.map((c) => c.code) as [
  ShippingCarrierCode,
  ...ShippingCarrierCode[],
]

export function carrierLabel(code: string): string {
  return SHIPPING_CARRIERS.find((c) => c.code === code)?.label ?? code
}

/**
 * The link a customer follows to track a parcel, or null when there is none.
 *
 * A pasted link is honoured for `other` only: for a listed carrier the link is
 * built here, so an admin typo can never send a customer to an arbitrary site.
 */
export function trackingUrlFor(
  carrier: string,
  trackingNumber: string | null | undefined,
  manualUrl?: string | null,
): string | null {
  const def = SHIPPING_CARRIERS.find((c) => c.code === carrier)
  if (!def) return null
  if (def.trackingUrl === null) return manualUrl?.trim() || null
  const number = trackingNumber?.trim()
  if (!number) return null
  return def.trackingUrl.replace("{number}", encodeURIComponent(number))
}

/** An order line as the snapshot knows it: an armurerie variant or a Gun Art print. */
export interface ShippableLineRef {
  variantId?: string | null
  printId?: string | null
  qty: number
}

/**
 * What a parcel holds of one line. `part`/`parts` describe a split article: a
 * category B firearm travelling in two parcels appears twice, as 1/2 and 2/2.
 */
export interface ShipmentItemRef {
  variantId?: string | null
  printId?: string | null
  qty: number
  part: number
  parts: number
}

export interface ShipmentForAggregate {
  status: ShipmentStatus
  items: ShipmentItemRef[]
}

function lineKey(ref: { variantId?: string | null; printId?: string | null }): string | null {
  if (ref.variantId) return `variant:${ref.variantId}`
  if (ref.printId) return `print:${ref.printId}`
  return null
}

function sumQty(items: ShipmentItemRef[], key: string, part: number): number {
  return items.filter((i) => lineKey(i) === key && i.part === part).reduce((sum, i) => sum + i.qty, 0)
}

/** The split recorded for a line across ALL its parcels, or 1 when it was never split. */
function recordedParts(items: ShipmentItemRef[], key: string): number {
  return items.filter((i) => lineKey(i) === key).reduce((max, i) => Math.max(max, i.parts), 1)
}

/** How many whole units of a line `items` cover: a unit counts once every one of its parts is there. */
function unitsCovered(items: ShipmentItemRef[], key: string, parts: number): number {
  let units = Number.POSITIVE_INFINITY
  for (let part = 1; part <= parts; part++) units = Math.min(units, sumQty(items, key, part))
  return Number.isFinite(units) ? units : 0
}

/**
 * Collapse an order's parcels into its shipping status.
 *
 * ⚠️ Half a firearm in the post is not a shipped firearm: a line split in two
 * parcels only counts as shipped once BOTH have left.
 */
export function aggregateShippingStatus(
  lines: ShippableLineRef[],
  shipments: ShipmentForAggregate[],
): OrderShippingStatus {
  const allItems = shipments.flatMap((s) => s.items)
  const leftItems = shipments.filter((s) => s.status !== "preparing").flatMap((s) => s.items)
  if (leftItems.length === 0) return "unshipped"

  const deliveredItems = shipments.filter((s) => s.status === "delivered").flatMap((s) => s.items)
  const shippable = lines.flatMap((l) => {
    const key = lineKey(l)
    return key && l.qty > 0 ? [{ key, qty: l.qty }] : []
  })
  const covers = (items: ShipmentItemRef[]) =>
    shippable.every((l) => unitsCovered(items, l.key, recordedParts(allItems, l.key)) >= l.qty)

  if (!covers(leftItems)) return "partially_shipped"
  return covers(deliveredItems) ? "delivered" : "shipped"
}

/**
 * Why a new parcel's content cannot be accepted, or null when it fits.
 *
 * `allocated` is what the order's existing parcels already hold. The messages
 * are API error messages, hence in English.
 */
export function findAllocationError(
  lines: ShippableLineRef[],
  allocated: ShipmentItemRef[],
  added: ShipmentItemRef[],
): string | null {
  const seen = new Set<string>()
  for (const item of added) {
    const key = lineKey(item)
    if (!key) return "A parcel item must reference a variant or a print"
    const line = lines.find((l) => lineKey(l) === key)
    if (!line) return `${key} is not on this order`
    if (!Number.isInteger(item.qty) || item.qty < 1) return `Invalid quantity for ${key}`
    if (!Number.isInteger(item.parts) || item.parts < 1 || item.parts > MAX_PARCELS_PER_ARTICLE) {
      return `Invalid split for ${key}: an article travels in 1 to ${MAX_PARCELS_PER_ARTICLE} parcels`
    }
    if (!Number.isInteger(item.part) || item.part < 1 || item.part > item.parts) {
      return `Invalid part ${item.part}/${item.parts} for ${key}`
    }

    const slot = `${key}#${item.part}`
    if (seen.has(slot)) return `The same part of ${key} appears twice in one parcel`
    seen.add(slot)

    const recorded = [...allocated, ...added].find((i) => lineKey(i) === key && i.parts !== item.parts)
    if (recorded) return `The split of ${key} contradicts the split already recorded (${recorded.parts} parcels)`

    if (sumQty(allocated, key, item.part) + sumQty(added, key, item.part) > line.qty) {
      return `Packing more than ordered for ${key}`
    }
  }
  return null
}

export interface SplitLine {
  variantId?: string | null
  printId?: string | null
  name: string
  qty: number
  /** How many parcels one unit of this article needs (`products.parcel_count`). */
  parcelCount: number
}

export interface SuggestedParcelItem {
  variantId?: string
  printId?: string
  name: string
  qty: number
  part: number
  parts: number
}

export interface SuggestedParcel {
  items: SuggestedParcelItem[]
}

/**
 * A starting point for packing what is still left on an order — a suggestion
 * the admin edits, never something created on its own.
 *
 * Parcel k carries part k of every split article; articles that travel whole go
 * into the last parcel. A split already recorded on the order wins over the
 * product's current parcel count, which may have changed since.
 */
export function suggestShipmentSplit(lines: SplitLine[], allocated: ShipmentItemRef[]): SuggestedParcel[] {
  const byPart: SuggestedParcelItem[][] = []
  const whole: SuggestedParcelItem[] = []

  for (const line of lines) {
    const key = lineKey(line)
    if (!key || line.qty <= 0) continue
    const recorded = allocated.find((i) => lineKey(i) === key)
    const parts = recorded?.parts ?? Math.min(MAX_PARCELS_PER_ARTICLE, Math.max(1, Math.trunc(line.parcelCount) || 1))

    for (let part = 1; part <= parts; part++) {
      const qty = line.qty - sumQty(allocated, key, part)
      if (qty <= 0) continue
      const ref = line.variantId ? { variantId: line.variantId } : { printId: line.printId as string }
      const item = { ...ref, name: line.name, qty, part, parts }
      if (parts === 1) whole.push(item)
      else {
        byPart[part - 1] ??= []
        byPart[part - 1]?.push(item)
      }
    }
  }

  const parcels = byPart.filter(Boolean).map((items) => ({ items }))
  const last = parcels.at(-1)
  if (whole.length > 0) {
    if (last) last.items.push(...whole)
    else parcels.push({ items: whole })
  }
  return parcels
}

// Legal states in which the dossier no longer holds an order back: validated,
// or never required (`payment_pending` is where such an order rests until paid).
const LEGAL_CLEARED_STATES: readonly string[] = ["docs_verified", "payment_pending", "completed"]

export type ShipGate = { ok: true } | { ok: false; reason: "unpaid" | "legal" }

/**
 * Whether a parcel may be handed to the carrier. A parcel can be PREPARED at
 * any time; it cannot LEAVE before the money is in and — for a regulated
 * firearm — before the documents are validated.
 */
export function canShipOrder(order: { paymentStatus: string; legalVerificationStatus: string }): ShipGate {
  if (!PAID_PAYMENT_STATUSES.includes(order.paymentStatus)) return { ok: false, reason: "unpaid" }
  if (!LEGAL_CLEARED_STATES.includes(order.legalVerificationStatus)) return { ok: false, reason: "legal" }
  return { ok: true }
}
