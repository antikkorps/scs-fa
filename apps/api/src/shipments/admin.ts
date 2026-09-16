import {
  canShipOrder,
  carrierLabel,
  createShipmentSchema,
  findAllocationError,
  isPickupOrder,
  updateShipmentSchema,
  uuidParamSchema,
} from "@armurier/shared"
import { eq } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import { db } from "../db/client.js"
import { auditLogs, orders, shipmentItems, shipments } from "../db/schema.js"
import { validationError } from "../http.js"
import {
  allocatedItems,
  loadShipments,
  notifyShipmentShipped,
  recomputeOrderShippingStatus,
  toAdminShipment,
} from "./service.js"
import { trackingProviderFor } from "./tracking/index.js"
import { refreshShipmentTracking } from "./tracking/sync.js"

/** Thrown inside a transaction to roll it back and answer with a status code. */
class ShipmentProblem extends Error {
  constructor(
    readonly statusCode: 400 | 404 | 409,
    message: string,
  ) {
    super(message)
  }
}

const ERROR_NAMES = { 400: "ValidationError", 404: "NotFound", 409: "Conflict" } as const

const GATE_MESSAGES = {
  unpaid: "The order is not paid yet — a parcel cannot leave before the money is in",
  legal: "The legal documents of this order are not validated — a regulated firearm cannot leave before they are",
  pickup: "This order is marked for in-store pickup — it is collected, not shipped",
} as const

/**
 * Multi-parcel shipping, admin side (story 11.9). Mounted under /api/admin/shipments.
 *
 * Every change re-derives the order's shipping status in the same transaction.
 */
export const adminShipmentRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  fastify.setErrorHandler((err, _request, reply) => {
    if (err instanceof ShipmentProblem) {
      return reply.code(err.statusCode).send({ error: ERROR_NAMES[err.statusCode], message: err.message })
    }
    throw err
  })

  const reload = async (orderId: string, shipmentId: string) => {
    const parcel = (await loadShipments(orderId)).find((s) => s.id === shipmentId)
    if (!parcel) throw new ShipmentProblem(404, "Shipment not found")
    return toAdminShipment(parcel)
  }

  /** POST / — pack a parcel. Allowed at any time: only LEAVING is gated. */
  fastify.post("/", async (request, reply) => {
    const parsed = createShipmentSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const body = parsed.data

    const shipmentId = await db.transaction(async (tx) => {
      // Row lock: two admins packing the same order at once must not both pass
      // the allocation check against the same "what is left".
      const [order] = await tx
        .select({ id: orders.id, itemsJson: orders.itemsJson, shippingMethod: orders.shippingMethod })
        .from(orders)
        .where(eq(orders.id, body.orderId))
        .limit(1)
        .for("update")
      if (!order) throw new ShipmentProblem(404, "Order not found")
      // Packing is otherwise allowed at any time — but a pickup order has no
      // parcel to pack: refusing here beats letting one sit unsendable forever.
      if (isPickupOrder(order.shippingMethod)) throw new ShipmentProblem(409, GATE_MESSAGES.pickup)

      const existing = await loadShipments(order.id, tx)
      const problem = findAllocationError(order.itemsJson, allocatedItems(existing), body.items)
      if (problem) throw new ShipmentProblem(400, problem)

      const [row] = await tx
        .insert(shipments)
        .values({
          orderId: order.id,
          position: existing.reduce((max, s) => Math.max(max, s.position), 0) + 1,
          carrier: body.carrier,
          trackingNumber: body.trackingNumber ?? null,
          trackingUrl: body.carrier === "other" ? (body.trackingUrl ?? null) : null,
          notes: body.notes ?? null,
          createdBy: request.user.sub,
        })
        .returning({ id: shipments.id, position: shipments.position })
      if (!row) throw new Error("Shipment insert returned no row")

      const labelOf = (ref: { variantId?: string; printId?: string }) =>
        order.itemsJson.find((l) => (ref.variantId ? l.variantId === ref.variantId : l.printId === ref.printId))
          ?.name ?? "Article"
      await tx.insert(shipmentItems).values(
        body.items.map((i) => ({
          shipmentId: row.id,
          variantId: i.variantId ?? null,
          printId: i.printId ?? null,
          label: labelOf(i).slice(0, 255),
          qty: i.qty,
          part: i.part,
          parts: i.parts,
        })),
      )

      await tx.insert(auditLogs).values({
        userId: request.user.sub,
        userRole: "admin",
        entityType: "shipment",
        entityId: row.id,
        action: "shipment.created",
        newValue: { orderId: order.id, position: row.position, carrier: body.carrier, items: body.items },
      })
      await recomputeOrderShippingStatus(order.id, tx)
      return row.id
    })

    return reply.code(201).send({ data: await reload(body.orderId, shipmentId) })
  })

  /**
   * PATCH /:id — tracking details and the parcel's status.
   *
   * Leaving (`shipped`, then `delivered`) is gated on a paid order whose legal
   * dossier is cleared, and on a tracking number for a listed carrier.
   */
  fastify.patch("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const parsed = updateShipmentSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const body = parsed.data

    const outcome = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(shipments).where(eq(shipments.id, params.data.id)).limit(1).for("update")
      if (!current) throw new ShipmentProblem(404, "Shipment not found")
      const [order] = await tx
        .select({
          paymentStatus: orders.paymentStatus,
          legalVerificationStatus: orders.legalVerificationStatus,
          shippingMethod: orders.shippingMethod,
        })
        .from(orders)
        .where(eq(orders.id, current.orderId))
        .limit(1)
      if (!order) throw new ShipmentProblem(404, "Order not found")

      const carrier = body.carrier ?? current.carrier
      const trackingNumber = body.trackingNumber === undefined ? current.trackingNumber : body.trackingNumber
      let trackingUrl = body.trackingUrl === undefined ? current.trackingUrl : body.trackingUrl
      if (carrier !== "other") {
        // For a listed carrier the link is built, never pasted.
        if (body.trackingUrl) {
          throw new ShipmentProblem(400, "A tracking link can only be pasted for a carrier outside the list")
        }
        trackingUrl = null
      }

      const next = body.status ?? current.status
      const leaving = next === "shipped" || next === "delivered"
      const patch: Partial<typeof shipments.$inferInsert> = {
        carrier,
        trackingNumber,
        trackingUrl,
        updatedAt: new Date(),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      }

      if (next !== current.status) {
        if (leaving) {
          const gate = canShipOrder(order)
          if (!gate.ok) throw new ShipmentProblem(409, GATE_MESSAGES[gate.reason])
        }
        if (next === "delivered" && current.status !== "shipped") {
          throw new ShipmentProblem(409, "A parcel must have left before it can be delivered")
        }
        patch.shippedAt = next === "preparing" ? null : (current.shippedAt ?? new Date())
        patch.deliveredAt = next === "delivered" ? new Date() : null
        patch.status = next
      }
      if (leaving && carrier !== "other" && !trackingNumber) {
        throw new ShipmentProblem(400, `A tracking number is required to ship with ${carrierLabel(carrier)}`)
      }

      await tx.update(shipments).set(patch).where(eq(shipments.id, current.id))
      await tx.insert(auditLogs).values({
        userId: request.user.sub,
        userRole: "admin",
        entityType: "shipment",
        entityId: current.id,
        action: next !== current.status ? `shipment.${next}` : "shipment.updated",
        oldValue: { status: current.status, carrier: current.carrier, trackingNumber: current.trackingNumber },
        newValue: { status: next, carrier, trackingNumber },
      })
      await recomputeOrderShippingStatus(current.orderId, tx)
      return { orderId: current.orderId, leftNow: next === "shipped" && current.status !== "shipped" }
    })

    // After the commit: the customer is only told about a dispatch that is recorded.
    if (outcome.leftNow) await notifyShipmentShipped(params.data.id, request.log)
    return reply.send({ data: await reload(outcome.orderId, params.data.id) })
  })

  /**
   * POST /:id/refresh-tracking — ask the carrier about this parcel, now.
   *
   * The same code path the scheduler runs, aimed at one parcel: an admin who
   * wants an answer should not have to wait for the next poll. Marking a parcel
   * delivered by hand stays available, and is what happens for a carrier we
   * cannot ask.
   */
  fastify.post("/:id/refresh-tracking", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))

    const [parcel] = await db.select().from(shipments).where(eq(shipments.id, params.data.id)).limit(1)
    if (!parcel) throw new ShipmentProblem(404, "Shipment not found")
    if (parcel.status !== "shipped") {
      throw new ShipmentProblem(409, "Only a parcel on its way can be tracked")
    }
    if (!parcel.trackingNumber || !trackingProviderFor(parcel.carrier)) {
      throw new ShipmentProblem(
        409,
        `Automatic tracking is not available for this parcel — mark it delivered by hand when it arrives`,
      )
    }

    await refreshShipmentTracking(parcel.id, request.log)
    return reply.send({ data: await reload(parcel.orderId, parcel.id) })
  })

  /** DELETE /:id — only a parcel still being prepared. One that has left is a fact. */
  fastify.delete("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))

    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(shipments).where(eq(shipments.id, params.data.id)).limit(1).for("update")
      if (!current) throw new ShipmentProblem(404, "Shipment not found")
      if (current.status !== "preparing") {
        throw new ShipmentProblem(
          409,
          "Only a parcel still being prepared can be deleted — one that has left is a fact",
        )
      }

      await tx.delete(shipments).where(eq(shipments.id, current.id))
      await tx.insert(auditLogs).values({
        userId: request.user.sub,
        userRole: "admin",
        entityType: "shipment",
        entityId: current.id,
        action: "shipment.deleted",
        oldValue: { orderId: current.orderId, position: current.position, carrier: current.carrier },
      })
      await recomputeOrderShippingStatus(current.orderId, tx)
    })
    return reply.code(204).send()
  })
}
