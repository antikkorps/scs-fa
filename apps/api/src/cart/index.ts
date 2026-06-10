import { cartItemSchema, updateCartItemSchema, uuidParamSchema } from "@armurier/shared"
import { and, eq } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { releasePrintFromCart, reservePrintForCart } from "../artworks/reservation.js"
import { authenticate } from "../auth/authenticate.js"
import { db } from "../db/client.js"
import { artworkCartItems, artworkPrints, cartItems, products, productVariants } from "../db/schema.js"
import { validationError } from "../http.js"
import { loadCart } from "./service.js"

export const cartRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)

  // GET /api/cart — the authenticated user's cart with computed totals
  fastify.get("/", async (request, reply) => {
    const cart = await loadCart(request.user.sub)
    return reply.code(200).send({ data: cart })
  })

  // POST /api/cart/items — add a product variant or an artwork print
  fastify.post("/items", async (request, reply) => {
    const parsed = cartItemSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send(validationError(parsed.error.issues))
    }

    const userId = request.user.sub
    const { variantId, printId, qty } = parsed.data

    if (variantId) {
      const [variant] = await db
        .select({
          stockQty: productVariants.stockQty,
          priceDeltaHt: productVariants.priceDeltaHt,
          productPriceHt: products.priceHt,
          published: products.published,
        })
        .from(productVariants)
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(eq(productVariants.id, variantId))
        .limit(1)

      if (!variant?.published) {
        return reply.code(404).send({ error: "NotFound", message: "Variant not found" })
      }

      const unitPriceHt = Number(variant.productPriceHt) + Number(variant.priceDeltaHt ?? 0)

      const [existing] = await db
        .select({ id: cartItems.id, qty: cartItems.qty })
        .from(cartItems)
        .where(and(eq(cartItems.userId, userId), eq(cartItems.variantId, variantId)))
        .limit(1)

      const newQty = (existing?.qty ?? 0) + qty
      if (variant.stockQty !== null && newQty > variant.stockQty) {
        return reply.code(400).send({
          error: "InsufficientStock",
          message: `Only ${variant.stockQty} unit(s) available`,
        })
      }

      if (existing) {
        await db.update(cartItems).set({ qty: newQty, updatedAt: new Date() }).where(eq(cartItems.id, existing.id))
      } else {
        await db.insert(cartItems).values({
          userId,
          variantId,
          qty,
          priceHtAtTime: unitPriceHt.toFixed(2),
        })
      }

      const cart = await loadCart(userId)
      return reply.code(201).send({ data: cart })
    }

    // printId path (artwork): each print is a unique, single-quantity item.
    const id = printId as string

    const [print] = await db
      .select({ id: artworkPrints.id })
      .from(artworkPrints)
      .where(eq(artworkPrints.id, id))
      .limit(1)
    if (!print) {
      return reply.code(404).send({ error: "NotFound", message: "Print not found" })
    }

    const [existing] = await db
      .select({ id: artworkCartItems.id })
      .from(artworkCartItems)
      .where(and(eq(artworkCartItems.userId, userId), eq(artworkCartItems.printId, id)))
      .limit(1)
    if (existing) {
      return reply.code(409).send({ error: "Conflict", message: "Print already in cart" })
    }

    // Claim the print and create the cart line atomically: if the claim loses the
    // race (or the insert fails) the whole reservation rolls back — no orphan hold.
    const claimed = await db.transaction(async (tx) => {
      const reserved = await reservePrintForCart(id, tx)
      if (!reserved) return null
      await tx.insert(artworkCartItems).values({ userId, printId: id, priceHtAtTime: reserved.priceHtUnit })
      return reserved
    })
    if (!claimed) {
      return reply.code(409).send({ error: "Conflict", message: "Print is not available" })
    }

    const cart = await loadCart(userId)
    return reply.code(201).send({ data: cart })
  })

  // PATCH /api/cart/items/:id — change the quantity of a product variant line
  fastify.patch("/items/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(validationError(params.error.issues))
    }
    const body = updateCartItemSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send(validationError(body.error.issues))
    }

    const userId = request.user.sub
    const { id } = params.data

    const [row] = await db
      .select({ stockQty: productVariants.stockQty })
      .from(cartItems)
      .innerJoin(productVariants, eq(cartItems.variantId, productVariants.id))
      .where(and(eq(cartItems.id, id), eq(cartItems.userId, userId)))
      .limit(1)

    if (!row) {
      return reply.code(404).send({ error: "NotFound", message: "Cart item not found" })
    }
    if (row.stockQty !== null && body.data.qty > row.stockQty) {
      return reply.code(400).send({
        error: "InsufficientStock",
        message: `Only ${row.stockQty} unit(s) available`,
      })
    }

    await db.update(cartItems).set({ qty: body.data.qty, updatedAt: new Date() }).where(eq(cartItems.id, id))

    const cart = await loadCart(userId)
    return reply.code(200).send({ data: cart })
  })

  // DELETE /api/cart/items/:id — remove a product variant line
  fastify.delete("/items/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(validationError(params.error.issues))
    }
    const userId = request.user.sub
    const deleted = await db
      .delete(cartItems)
      .where(and(eq(cartItems.id, params.data.id), eq(cartItems.userId, userId)))
      .returning({ id: cartItems.id })

    if (deleted.length === 0) {
      return reply.code(404).send({ error: "NotFound", message: "Cart item not found" })
    }
    return reply.code(204).send()
  })

  // DELETE /api/cart/artwork-items/:id — remove an artwork print line
  fastify.delete("/artwork-items/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(validationError(params.error.issues))
    }
    const userId = request.user.sub
    // Remove the line and release its print back to available, atomically.
    const removed = await db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(artworkCartItems)
        .where(and(eq(artworkCartItems.id, params.data.id), eq(artworkCartItems.userId, userId)))
        .returning({ printId: artworkCartItems.printId })
      if (!deleted) return false
      await releasePrintFromCart(deleted.printId, tx)
      return true
    })

    if (!removed) {
      return reply.code(404).send({ error: "NotFound", message: "Cart item not found" })
    }
    return reply.code(204).send()
  })

  // DELETE /api/cart — clear the whole cart, releasing every reserved print
  fastify.delete("/", async (request, reply) => {
    const userId = request.user.sub
    await db.transaction(async (tx) => {
      await tx.delete(cartItems).where(eq(cartItems.userId, userId))
      const removed = await tx
        .delete(artworkCartItems)
        .where(eq(artworkCartItems.userId, userId))
        .returning({ printId: artworkCartItems.printId })
      for (const r of removed) {
        await releasePrintFromCart(r.printId, tx)
      }
    })
    return reply.code(204).send()
  })
}
