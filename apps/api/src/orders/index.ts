import {
  calculateOrderPaymentSplit,
  createOrderSchema,
  paginationSchema,
  requiresVirement,
  round2,
  uuidParamSchema,
} from "@armurier/shared"
import { and, desc, eq, gte, sql } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { reservePrintForOrder } from "../artworks/reservation.js"
import { authenticate } from "../auth/authenticate.js"
import { loadCart } from "../cart/service.js"
import { db } from "../db/client.js"
import {
  addresses,
  artworkCartItems,
  auditLogs,
  cartItems,
  type OrderAddressSnapshot,
  orders,
  productVariants,
} from "../db/schema.js"
import { validationError } from "../http.js"
import { buildRequiredDocsView, loadUserDocs, recomputeOrderLegalStatus, requiredDocTypesFor } from "./legal-status.js"

class OrderError extends Error {
  constructor(
    readonly statusCode: number,
    readonly errorCode: string,
    message: string,
  ) {
    super(message)
  }
}

const ADDRESS_FIELDS = {
  firstName: addresses.firstName,
  lastName: addresses.lastName,
  line1: addresses.line1,
  line2: addresses.line2,
  postal: addresses.postal,
  city: addresses.city,
  country: addresses.country,
  phone: addresses.phone,
} as const

function toSnapshot(a: {
  firstName: string
  lastName: string
  line1: string
  line2: string | null
  postal: string
  city: string
  country: string
  phone: string | null
}): OrderAddressSnapshot {
  return {
    firstName: a.firstName,
    lastName: a.lastName,
    line1: a.line1,
    line2: a.line2,
    postal: a.postal,
    city: a.city,
    country: a.country,
    phone: a.phone,
  }
}

export const orderRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)

  // POST /api/orders — turn the user's cart into an order with an automatic payment split
  fastify.post("/", async (request, reply) => {
    const userId = request.user.sub
    const role = request.user.role

    const parsed = createOrderSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send(validationError(parsed.error.issues))
    }
    const { shippingAddressId, billingAddressId } = parsed.data

    const cart = await loadCart(userId)
    if (cart.summary.itemCount === 0) {
      return reply.code(400).send({ error: "EmptyCart", message: "Cart is empty" })
    }

    const [shipping] = await db
      .select(ADDRESS_FIELDS)
      .from(addresses)
      .where(and(eq(addresses.id, shippingAddressId), eq(addresses.userId, userId)))
      .limit(1)
    if (!shipping) {
      return reply.code(404).send({ error: "NotFound", message: "Shipping address not found" })
    }

    let billing = shipping
    if (billingAddressId && billingAddressId !== shippingAddressId) {
      const [b] = await db
        .select(ADDRESS_FIELDS)
        .from(addresses)
        .where(and(eq(addresses.id, billingAddressId), eq(addresses.userId, userId)))
        .limit(1)
      if (!b) {
        return reply.code(404).send({ error: "NotFound", message: "Billing address not found" })
      }
      billing = b
    }

    const shippingSnapshot = toSnapshot(shipping)
    const billingSnapshot = toSnapshot(billing)

    // Payment split is computed on the net (VIP-discounted) line amounts
    const splitItems = [
      ...cart.items.map((l) => ({
        priceHt: round2(l.lineHt - l.discountAmount),
        vatPct: l.vatPct,
        requiresPaymentVirement: requiresVirement(l.legalCategory),
      })),
      ...cart.artworkItems.map((l) => ({
        priceHt: round2(l.lineHt - l.discountAmount),
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
        legalCategory: l.legalCategory,
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
            vipDiscountAmount: cart.summary.vipDiscountAmount.toFixed(2),
            vipDiscountAppliedPct: (cart.summary.subtotalHt > 0
              ? round2((cart.summary.vipDiscountAmount / cart.summary.subtotalHt) * 100)
              : 0
            ).toFixed(2),
            shippingAddress: shippingSnapshot,
            billingAddress: billingSnapshot,
            shippingAddressStreet: shippingSnapshot.line1,
            shippingAddressPostal: shippingSnapshot.postal,
            shippingAddressCity: shippingSnapshot.city,
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

        // Promote the cart-held prints to this order (in_cart -> reserved)
        for (const line of cart.artworkItems) {
          const reserved = await reservePrintForOrder(line.printId, order.id, tx)
          if (!reserved) {
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
        shippingAddress: shippingSnapshot,
        billingAddress: billingSnapshot,
      },
    })
  })

  // GET /api/orders — the authenticated user's orders (most recent first)
  fastify.get("/", async (request, reply) => {
    const parsed = paginationSchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send(validationError(parsed.error.issues))
    }
    const { page, limit } = parsed.data
    const userId = request.user.sub

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(orders)
      .where(eq(orders.userId, userId))

    const rows = await db
      .select({
        id: orders.id,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        legalVerificationStatus: orders.legalVerificationStatus,
        paymentStatus: orders.paymentStatus,
        subtotalHt: orders.subtotalHt,
        vatAmount: orders.vatAmount,
        totalTtc: orders.totalTtc,
        itemsJson: orders.itemsJson,
      })
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset((page - 1) * limit)

    const data = rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      legalVerificationStatus: r.legalVerificationStatus,
      paymentStatus: r.paymentStatus,
      subtotalHt: Number(r.subtotalHt),
      vatAmount: Number(r.vatAmount),
      totalTtc: Number(r.totalTtc),
      itemCount: r.itemsJson.reduce((sum, i) => sum + i.qty, 0),
    }))

    return reply.code(200).send({
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    })
  })

  // GET /api/orders/:id — a single order owned by the authenticated user
  fastify.get("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(validationError(params.error.issues))
    }
    const userId = request.user.sub

    const [order] = await db
      .select({
        id: orders.id,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        legalVerificationStatus: orders.legalVerificationStatus,
        paymentStatus: orders.paymentStatus,
        subtotalHt: orders.subtotalHt,
        vatAmount: orders.vatAmount,
        totalTtc: orders.totalTtc,
        vipDiscountAmount: orders.vipDiscountAmount,
        vipDiscountAppliedPct: orders.vipDiscountAppliedPct,
        items: orders.itemsJson,
        shippingAddress: orders.shippingAddress,
        billingAddress: orders.billingAddress,
      })
      .from(orders)
      .where(and(eq(orders.id, params.data.id), eq(orders.userId, userId)))
      .limit(1)

    if (!order) {
      return reply.code(404).send({ error: "NotFound", message: "Order not found" })
    }

    return reply.code(200).send({
      data: {
        ...order,
        subtotalHt: Number(order.subtotalHt),
        vatAmount: Number(order.vatAmount),
        totalTtc: Number(order.totalTtc),
        vipDiscountAmount: Number(order.vipDiscountAmount),
        vipDiscountAppliedPct: Number(order.vipDiscountAppliedPct),
      },
    })
  })

  // GET /api/orders/:id/legal — the order's legal checklist for the customer:
  // which doc types are required and where each one stands.
  fastify.get("/:id/legal", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(validationError(params.error.issues))
    }
    const userId = request.user.sub

    // Self-healing read: re-derive statuses (e.g. an async scan flagged a file)
    // before serving, so the stored state can never drift from the documents.
    await recomputeOrderLegalStatus(userId)

    const [order] = await db
      .select({
        id: orders.id,
        legalVerificationStatus: orders.legalVerificationStatus,
        legalRejectionReason: orders.legalRejectionReason,
        legalVerifiedAt: orders.legalVerifiedAt,
        itemsJson: orders.itemsJson,
      })
      .from(orders)
      .where(and(eq(orders.id, params.data.id), eq(orders.userId, userId)))
      .limit(1)
    if (!order) {
      return reply.code(404).send({ error: "NotFound", message: "Order not found" })
    }

    const requiredTypes = await requiredDocTypesFor(order.itemsJson)
    const requiredDocs =
      requiredTypes.length === 0 ? [] : buildRequiredDocsView(requiredTypes, await loadUserDocs(userId))

    return reply.code(200).send({
      data: {
        orderId: order.id,
        requiresVerification: requiredTypes.length > 0,
        legalVerificationStatus: order.legalVerificationStatus,
        legalRejectionReason: order.legalRejectionReason,
        legalVerifiedAt: order.legalVerifiedAt,
        requiredDocs,
      },
    })
  })
}
