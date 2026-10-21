import {
  MAX_QUOTE_LINE_QTY,
  MAX_QUOTE_LINES,
  quoteBasketItemSchema,
  quoteBasketQtySchema,
  uuidParamSchema,
} from "@armurier/shared"
import { and, asc, count, eq, type SQL, sql } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import type { DbExecutor } from "../artworks/reservation.js"
import { db } from "../db/client.js"
import { legalCategories, productCategories, products, productVariants, quoteBasketItems, users } from "../db/schema.js"
import { validationError } from "../http.js"
import { proCatalogueVisible } from "../products/visibility.js"
import { type ProOrganisation, proOrganisationOf } from "./access.js"
import { netPrices } from "./prices.js"

const NOT_AVAILABLE = {
  error: "NotAvailableForQuote",
  message: "This item cannot be asked for a quote",
}
const LINE_NOT_FOUND = { error: "NotFound", message: "Basket line not found" }

/** What a variant is, in words: « Bronzé · 9 mm », or null. */
export function variantLabel(variant: { finition: string | null; munition: string | null; couleur: string | null }) {
  return [variant.finition, variant.munition, variant.couleur].filter(Boolean).join(" · ") || null
}

/**
 * The basket's lines with everything a request freezes — public price
 * included, for SCS. Never sent to the pro as such: see `toPublicLine`.
 */
export async function loadBasket(userId: string, executor: DbExecutor = db) {
  const rows = await executor
    .select({
      id: quoteBasketItems.id,
      qty: quoteBasketItems.qty,
      variantId: productVariants.id,
      skuVariant: productVariants.skuVariant,
      finition: productVariants.finition,
      munition: productVariants.munition,
      couleur: productVariants.couleur,
      priceDeltaHt: productVariants.priceDeltaHt,
      productId: products.id,
      slug: products.slug,
      name: products.name,
      sku: products.sku,
      featuredImageUrl: products.featuredImageUrl,
      priceHt: products.priceHt,
      vatPct: products.vatPct,
      legalCategory: legalCategories.category,
      // Still in the pro catalogue: a product unpublished since is flagged, not hidden.
      available: sql<boolean>`(${proCatalogueVisible()})`,
    })
    .from(quoteBasketItems)
    .innerJoin(productVariants, eq(productVariants.id, quoteBasketItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(productCategories, eq(productCategories.id, products.categoryId))
    .leftJoin(legalCategories, eq(legalCategories.id, products.legalCategoryId))
    .where(eq(quoteBasketItems.userId, userId))
    .orderBy(asc(quoteBasketItems.addedAt), asc(quoteBasketItems.id))

  return rows.map((row) => ({
    ...row,
    variantLabel: variantLabel(row),
    publicPriceHt: Number(row.priceHt) + Number(row.priceDeltaHt ?? 0),
    vatPct: Number(row.vatPct ?? 0),
  }))
}

type BasketLine = Awaited<ReturnType<typeof loadBasket>>[number]

/** A line as the pro sees it: no public price, their net one if SCS opened prices. */
function toPublicLine(line: BasketLine, organisation: ProOrganisation) {
  return {
    id: line.id,
    qty: line.qty,
    available: line.available,
    variant: { id: line.variantId, skuVariant: line.skuVariant, label: line.variantLabel },
    product: {
      id: line.productId,
      slug: line.slug,
      name: line.name,
      sku: line.sku,
      featuredImageUrl: line.featuredImageUrl,
      legalCategory: line.legalCategory,
    },
    ...netPrices(line.publicPriceHt, line.vatPct, organisation),
  }
}

class BasketRuleError extends Error {
  constructor(
    readonly status: number,
    readonly body: { error: string; message: string },
  ) {
    super(body.message)
  }
}

/** The pro's basket being prepared (story 12.8c): what and how many, never a price. */
export const quoteBasketRoutes: FastifyPluginAsync = async (fastify) => {
  const basketOf = async (userId: string, organisation: ProOrganisation) => ({
    items: (await loadBasket(userId)).map((line) => toPublicLine(line, organisation)),
  })

  fastify.get("/", async (request, reply) => {
    return reply.send({ data: await basketOf(request.user.sub, proOrganisationOf(request)) })
  })

  fastify.post("/items", async (request, reply) => {
    const parsed = quoteBasketItemSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const { variantId, qty } = parsed.data
    const userId = request.user.sub

    const [eligible] = await db
      .select({ id: productVariants.id })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .innerJoin(productCategories, eq(productCategories.id, products.categoryId))
      .where(and(eq(productVariants.id, variantId), proCatalogueVisible()) as SQL)
    if (!eligible) return reply.code(404).send(NOT_AVAILABLE)

    try {
      await db.transaction(async (tx) => {
        // One basket change at a time per pro: the line cap holds under concurrent adds.
        await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update")

        const [existing] = await tx
          .select({ id: quoteBasketItems.id, qty: quoteBasketItems.qty })
          .from(quoteBasketItems)
          .where(and(eq(quoteBasketItems.userId, userId), eq(quoteBasketItems.variantId, variantId)))
        if (existing) {
          if (existing.qty + qty > MAX_QUOTE_LINE_QTY) {
            throw new BasketRuleError(409, {
              error: "QuantityTooLarge",
              message: `A line holds ${MAX_QUOTE_LINE_QTY} units at most`,
            })
          }
          await tx
            .update(quoteBasketItems)
            .set({ qty: existing.qty + qty, updatedAt: new Date() })
            .where(eq(quoteBasketItems.id, existing.id))
          return
        }

        const [lines] = await tx
          .select({ total: count() })
          .from(quoteBasketItems)
          .where(eq(quoteBasketItems.userId, userId))
        if ((lines?.total ?? 0) >= MAX_QUOTE_LINES) {
          throw new BasketRuleError(409, {
            error: "BasketFull",
            message: `A quote request holds ${MAX_QUOTE_LINES} lines at most`,
          })
        }
        await tx.insert(quoteBasketItems).values({ userId, variantId, qty })
      })
    } catch (err) {
      if (err instanceof BasketRuleError) return reply.code(err.status).send(err.body)
      throw err
    }
    return reply.code(201).send({ data: await basketOf(userId, proOrganisationOf(request)) })
  })

  fastify.patch("/items/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const parsed = quoteBasketQtySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))

    const updated = await db
      .update(quoteBasketItems)
      .set({ qty: parsed.data.qty, updatedAt: new Date() })
      .where(and(eq(quoteBasketItems.id, params.data.id), eq(quoteBasketItems.userId, request.user.sub)))
      .returning({ id: quoteBasketItems.id })
    if (updated.length === 0) return reply.code(404).send(LINE_NOT_FOUND)
    return reply.send({ data: await basketOf(request.user.sub, proOrganisationOf(request)) })
  })

  fastify.delete("/items/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))

    const removed = await db
      .delete(quoteBasketItems)
      .where(and(eq(quoteBasketItems.id, params.data.id), eq(quoteBasketItems.userId, request.user.sub)))
      .returning({ id: quoteBasketItems.id })
    if (removed.length === 0) return reply.code(404).send(LINE_NOT_FOUND)
    return reply.code(204).send()
  })
}
