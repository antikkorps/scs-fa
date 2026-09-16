import {
  aggregateShippingStatus,
  canShipOrder,
  carrierLabel,
  type OrderShippingStatus,
  type ShipmentItemRef,
  suggestShipmentSplit,
  trackingUrlFor,
} from "@armurier/shared"
import { and, asc, eq, inArray, isNull } from "drizzle-orm"
import { db } from "../db/client.js"
import { orders, products, productVariants, shipmentItems, shipments, users } from "../db/schema.js"
import { sendShipmentShippedEmail } from "../email.js"

type DbExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db

type OrderLines = (typeof orders.$inferSelect)["itemsJson"]
type ShipmentItemRow = typeof shipmentItems.$inferSelect
export type ShipmentWithItems = typeof shipments.$inferSelect & { items: ShipmentItemRow[] }

/** An order's parcels with their content, in the order they were created. */
export async function loadShipments(orderId: string, tx: DbExecutor = db): Promise<ShipmentWithItems[]> {
  const rows = await tx.select().from(shipments).where(eq(shipments.orderId, orderId)).orderBy(asc(shipments.position))
  if (rows.length === 0) return []
  const items = await tx
    .select()
    .from(shipmentItems)
    .where(
      inArray(
        shipmentItems.shipmentId,
        rows.map((r) => r.id),
      ),
    )
  return rows.map((r) => ({ ...r, items: items.filter((i) => i.shipmentId === r.id) }))
}

const asRef = (i: ShipmentItemRow): ShipmentItemRef => ({
  variantId: i.variantId,
  printId: i.printId,
  qty: i.qty,
  part: i.part,
  parts: i.parts,
})

/** Everything already packed across an order's parcels. */
export function allocatedItems(list: ShipmentWithItems[]): ShipmentItemRef[] {
  return list.flatMap((s) => s.items.map(asRef))
}

/**
 * Re-derive `orders.shipping_status` from the order's parcels.
 *
 * The ONLY writer of that column: it is stored so the admin list can filter on
 * it, and having a single writer is what keeps it from drifting from the parcels.
 */
export async function recomputeOrderShippingStatus(
  orderId: string,
  tx: DbExecutor = db,
): Promise<OrderShippingStatus | null> {
  const [order] = await tx.select({ itemsJson: orders.itemsJson }).from(orders).where(eq(orders.id, orderId)).limit(1)
  if (!order) return null
  const list = await loadShipments(orderId, tx)
  const status = aggregateShippingStatus(
    order.itemsJson,
    list.map((s) => ({ status: s.status, items: s.items.map(asRef) })),
  )
  await tx.update(orders).set({ shippingStatus: status, updatedAt: new Date() }).where(eq(orders.id, orderId))
  return status
}

/**
 * A packing suggestion for what is still left on the order.
 *
 * Parcel counts are read from the products as they are TODAY — acceptable for a
 * suggestion, and each parcel freezes its own split once created.
 */
async function suggestParcels(lines: OrderLines, list: ShipmentWithItems[]) {
  const variantIds = lines.map((l) => l.variantId).filter((id): id is string => Boolean(id))
  const counts =
    variantIds.length === 0
      ? []
      : await db
          .select({ variantId: productVariants.id, parcelCount: products.parcelCount })
          .from(productVariants)
          .innerJoin(products, eq(productVariants.productId, products.id))
          .where(inArray(productVariants.id, variantIds))
  const parcelCountOf = new Map(counts.map((c) => [c.variantId, c.parcelCount]))

  return suggestShipmentSplit(
    lines.map((l) => ({
      variantId: l.variantId,
      printId: l.printId,
      name: l.name,
      qty: l.qty,
      // A Gun Art print travels in a single tube.
      parcelCount: l.variantId ? (parcelCountOf.get(l.variantId) ?? 1) : 1,
    })),
    allocatedItems(list),
  )
}

export function toAdminShipment(s: ShipmentWithItems) {
  return {
    id: s.id,
    orderId: s.orderId,
    position: s.position,
    carrier: s.carrier,
    carrierLabel: carrierLabel(s.carrier),
    trackingNumber: s.trackingNumber,
    trackingUrl: trackingUrlFor(s.carrier, s.trackingNumber, s.trackingUrl),
    status: s.status,
    shippedAt: s.shippedAt,
    deliveredAt: s.deliveredAt,
    notifiedAt: s.notifiedAt,
    trackingCheckedAt: s.trackingCheckedAt,
    trackingLabel: s.trackingLabel,
    notes: s.notes,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    items: s.items.map((i) => ({
      id: i.id,
      variantId: i.variantId,
      printId: i.printId,
      label: i.label,
      qty: i.qty,
      part: i.part,
      parts: i.parts,
    })),
  }
}

/** What the customer may see of a parcel: where it is — never the internal notes. */
function toCustomerShipment(s: ShipmentWithItems) {
  return {
    position: s.position,
    status: s.status,
    carrier: s.carrier,
    carrierLabel: carrierLabel(s.carrier),
    trackingNumber: s.trackingNumber,
    trackingUrl: trackingUrlFor(s.carrier, s.trackingNumber, s.trackingUrl),
    shippedAt: s.shippedAt,
    deliveredAt: s.deliveredAt,
    // The carrier's own public wording — the same thing the tracking link shows.
    // The internal note stays out, as it always has.
    trackingLabel: s.trackingLabel,
    items: s.items.map((i) => ({ label: i.label, qty: i.qty, part: i.part, parts: i.parts })),
  }
}

/** The shipping block of the admin order screen. */
export async function adminShippingView(order: {
  id: string
  items: OrderLines
  paymentStatus: string
  legalVerificationStatus: string
  shippingMethod?: string | null
}) {
  const list = await loadShipments(order.id)
  const gate = canShipOrder(order)
  return {
    shipGate: gate,
    shipments: list.map(toAdminShipment),
    // Nothing will ever be posted for a pickup order: suggesting parcels for it
    // would only invite an admin to pack something that cannot leave.
    suggestedParcels: gate.ok === false && gate.reason === "pickup" ? [] : await suggestParcels(order.items, list),
  }
}

export async function customerShipments(orderId: string) {
  return (await loadShipments(orderId)).map(toCustomerShipment)
}

interface Logger {
  warn: (obj: object, msg: string) => void
}

/**
 * Tell the customer a parcel has left — exactly once per parcel.
 *
 * The parcel is CLAIMED first (`notified_at` set only if still empty), so a
 * back-and-forth correction never mails twice. If the provider fails, the claim
 * is released: the parcel stays shipped, and the next legitimate transition may
 * try again. Best-effort by design — a mail outage must not block a dispatch.
 */
export async function notifyShipmentShipped(shipmentId: string, log: Logger): Promise<void> {
  const [claimed] = await db
    .update(shipments)
    .set({ notifiedAt: new Date() })
    .where(and(eq(shipments.id, shipmentId), isNull(shipments.notifiedAt)))
    .returning({ id: shipments.id, orderId: shipments.orderId })
  if (!claimed) return

  try {
    const [owner] = await db
      .select({ email: users.email })
      .from(orders)
      .innerJoin(users, eq(users.id, orders.userId))
      .where(eq(orders.id, claimed.orderId))
      .limit(1)
    const list = await loadShipments(claimed.orderId)
    const index = list.findIndex((s) => s.id === claimed.id)
    const parcel = list[index]
    if (!owner || !parcel) return

    await sendShipmentShippedEmail(owner.email, {
      orderId: claimed.orderId,
      orderRef: claimed.orderId.slice(0, 8).toUpperCase(),
      position: index + 1,
      total: list.length,
      carrierLabel: carrierLabel(parcel.carrier),
      trackingNumber: parcel.trackingNumber,
      trackingUrl: trackingUrlFor(parcel.carrier, parcel.trackingNumber, parcel.trackingUrl),
      items: parcel.items.map((i) => ({ label: i.label, qty: i.qty, part: i.part, parts: i.parts })),
    })
  } catch (err) {
    await db.update(shipments).set({ notifiedAt: null }).where(eq(shipments.id, shipmentId))
    log.warn({ err, shipmentId }, "Shipment e-mail failed — notification released for a later retry")
  }
}
