import { calculateOrderPaymentSplit, requiresVirement } from "@armurier/shared"
import { and, eq, gte, sql } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { authenticate } from "../auth/authenticate.js"
import { loadCart } from "../cart/service.js"
import { db } from "../db/client.js"
import { artworkCartItems, artworkPrints, auditLogs, cartItems, orders, productVariants, users } from "../db/schema.js"

class OrderError extends Error {
  constructor(
    readonly statusCode: number,
    readonly errorCode: string,
    message: string,
  ) {
    super(message)
  }
}

export const orderRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)

  // POST /api/orders — turn the user's cart into an order with an automatic payment split
  fastify.post("/", async (request, reply) => {
    const userId = request.user.sub
    const role = request.user.role

    const cart = await loadCart(userId)
    if (cart.summary.itemCount === 0) {
      return reply.code(400).send({ error: "EmptyCart", message: "Cart is empty" })
    }

    const [user] = await db
      .select({
        addressStreet: users.addressStreet,
        addressPostal: users.addressPostal,
        addressCity: users.addressCity,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    if (!user?.addressStreet || !user.addressPostal || !user.addressCity) {
      return reply.code(400).send({
        error: "AddressRequired",
        message: "A complete shipping address is required on your profile",
      })
    }

    const splitItems = [
      ...cart.items.map((l) => ({
        priceHt: l.lineHt,
        vatPct: l.vatPct,
        requiresPaymentVirement: requiresVirement(l.legalCategory),
      })),
      ...cart.artworkItems.map((l) => ({
        priceHt: l.lineHt,
        vatPct: l.vatPct,
        requiresPaymentVirement: false,
      })),
    ]
    const split = calculateOrderPaymentSplit(splitItems)

    const needsLegalVerification = cart.items.some((l) => l.requiresLegalVerification)
    const legalStatus = needsLegalVerification ? "pending" : "payment_pending"

    const itemsJson = [
      ...cart.items.map((l) => ({
        variantId: l.variantId,
        qty: l.qty,
        priceHt: l.unitPriceHt,
        name: l.name,
        sku: l.sku,
        category: l.categorySlug,
        requiresPaymentVirement: requiresVirement(l.legalCategory),
      })),
      ...cart.artworkItems.map((l) => ({
        printId: l.printId,
        qty: 1,
        priceHt: l.unitPriceHt,
        name: l.title,
        sku: l.printDesignation,
        category: "gun-art",
        requiresPaymentVirement: false,
      })),
    ]

    let orderId: string
    try {
      orderId = await db.transaction(async (tx) => {
        const [order] = await tx
          .insert(orders)
          .values({
            userId,
            legalVerificationStatus: legalStatus,
            paymentStatus: "pending",
            itemsJson,
            subtotalHt: cart.summary.subtotalHt.toFixed(2),
            vatAmount: cart.summary.vatAmount.toFixed(2),
            totalTtc: cart.summary.totalTtc.toFixed(2),
            shippingAddressStreet: user.addressStreet,
            shippingAddressPostal: user.addressPostal,
            shippingAddressCity: user.addressCity,
          })
          .returning({ id: orders.id })

        // Decrement variant stock atomically (guard prevents overselling)
        for (const line of cart.items) {
          const updated = await tx
            .update(productVariants)
            .set({
              stockQty: sql`${productVariants.stockQty} - ${line.qty}`,
              updatedAt: new Date(),
            })
            .where(and(eq(productVariants.id, line.variantId), gte(productVariants.stockQty, line.qty)))
            .returning({ id: productVariants.id })
          if (updated.length === 0) {
            throw new OrderError(409, "InsufficientStock", `Insufficient stock for ${line.sku}`)
          }
        }

        // Reserve artwork prints (only if still available)
        for (const line of cart.artworkItems) {
          const updated = await tx
            .update(artworkPrints)
            .set({ status: "reserved", orderId: order.id, updatedAt: new Date() })
            .where(and(eq(artworkPrints.id, line.printId), eq(artworkPrints.status, "available")))
            .returning({ id: artworkPrints.id })
          if (updated.length === 0) {
            throw new OrderError(409, "Conflict", `Print ${line.printDesignation} is no longer available`)
          }
        }

        await tx.delete(cartItems).where(eq(cartItems.userId, userId))
        await tx.delete(artworkCartItems).where(eq(artworkCartItems.userId, userId))

        return order.id
      })
    } catch (err) {
      if (err instanceof OrderError) {
        return reply.code(err.statusCode).send({ error: err.errorCode, message: err.message })
      }
      throw err
    }

    await db.insert(auditLogs).values({
      userId,
      userRole: role,
      entityType: "order",
      entityId: orderId,
      action: "order.created",
      newValue: { totalTtc: cart.summary.totalTtc, splitType: split.splitType },
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    })

    return reply.code(201).send({
      data: {
        id: orderId,
        legalVerificationStatus: legalStatus,
        paymentStatus: "pending",
        requiresLegalVerification: needsLegalVerification,
        totals: cart.summary,
        paymentSplit: split,
      },
    })
  })
}
