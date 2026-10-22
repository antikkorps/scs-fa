import {
  calculateVipDiscount,
  computePriceTtc,
  computeShippingCost,
  computeVatTotals,
  requiresVirement,
  round2,
  type ShippableLine,
  type ShippingQuote,
} from "@armurier/shared"
import { and, asc, eq, sql } from "drizzle-orm"
import { printHeldUntil, printHoldActive, releasePrintFromCart } from "../artworks/reservation.js"
import { db } from "../db/client.js"
import {
  artworkCartItems,
  artworkPrints,
  artworks,
  cartItems,
  legalCategories,
  productCategories,
  products,
  productTags,
  productVariants,
  tags,
  users,
} from "../db/schema.js"
import { releaseUniquePiece } from "../products/reservation.js"
import { loadShippingRates } from "../shipping-rates/service.js"

// A product's tag slugs, as a correlated aggregate. Built with the query builder
// rather than a raw string so the `products.id` reference stays qualified — a
// bare "id" would be ambiguous against the joined tables inside the subquery.
const productTagSlugs = sql<string[]>`coalesce((${db
  .select({ slugs: sql`array_agg(${tags.slug})` })
  .from(productTags)
  .innerJoin(tags, eq(tags.id, productTags.tagId))
  .where(eq(productTags.productId, products.id))}), '{}')`

export interface CartProductLine {
  id: string
  variantId: string
  productId: string
  name: string
  sku: string
  skuVariant: string
  finition: string | null
  munition: string | null
  couleur: string | null
  qty: number
  stockQty: number | null
  vatPct: number
  unitPriceHt: number
  lineHt: number
  discountPct: number
  discountAmount: number
  lineTtc: number
  categorySlug: string
  tagSlugs: string[]
  legalCategory: string | null
  requiresLegalVerification: boolean
  /** Parcels one unit travels in — drives the firearm shipping rate (story 12.3). */
  parcelCount: number
  /** A unique piece held for this shopper goes back on sale past this; null otherwise (story 12.9a). */
  heldUntil: Date | null
}

export interface CartArtworkLine {
  id: string
  printId: string
  /** The print goes back on sale past this (story 12.9a). */
  heldUntil: Date
  artworkId: string
  title: string
  printDesignation: string
  formatId: string
  categorySlug: string
  vatPct: number
  unitPriceHt: number
  lineHt: number
  discountPct: number
  discountAmount: number
  lineTtc: number
}

export interface CartView {
  isVip: boolean
  items: CartProductLine[]
  artworkItems: CartArtworkLine[]
  summary: {
    itemCount: number
    /** Goods only, before the VIP discount. */
    subtotalHt: number
    vipDiscountAmount: number
    /** Goods AND shipping VAT. */
    vatAmount: number
    /** What the customer pays: goods and shipping (story 12.3). */
    totalTtc: number
    shipping: ShippingQuote
  }
}

/** A cart's lines as the shipping grid sees them. */
function shippableLinesOf(items: CartProductLine[], artworkItems: CartArtworkLine[]): ShippableLine[] {
  return [
    ...items.map((l) => ({
      kind: "product" as const,
      categorySlug: l.categorySlug,
      qty: l.qty,
      parcelCount: l.parcelCount,
      vatPct: l.vatPct,
      netHt: round2(l.lineHt - l.discountAmount),
      lineTtc: l.lineTtc,
      requiresPaymentVirement: requiresVirement(l.legalCategory),
    })),
    ...artworkItems.map((l) => ({
      kind: "print" as const,
      categorySlug: l.categorySlug,
      qty: 1,
      parcelCount: 1,
      vatPct: l.vatPct,
      netHt: round2(l.lineHt - l.discountAmount),
      lineTtc: l.lineTtc,
      requiresPaymentVirement: false,
    })),
  ]
}

/** Load and shape a user's cart (product variants + artwork prints) with computed totals and VIP discount. */
export async function loadCart(userId: string): Promise<CartView> {
  const [user] = await db.select({ vipActive: users.vipActive }).from(users).where(eq(users.id, userId)).limit(1)
  const isVip = user?.vipActive === true
  const now = new Date()

  const productRows = await db
    .select({
      id: cartItems.id,
      qty: cartItems.qty,
      priceHtAtTime: cartItems.priceHtAtTime,
      variantId: productVariants.id,
      skuVariant: productVariants.skuVariant,
      finition: productVariants.finition,
      munition: productVariants.munition,
      couleur: productVariants.couleur,
      stockQty: productVariants.stockQty,
      reservedBy: productVariants.reservedBy,
      reservedUntil: productVariants.reservedUntil,
      productId: products.id,
      name: products.name,
      sku: products.sku,
      vatPct: products.vatPct,
      marginPct: products.marginPct,
      requiresLegalVerification: products.requiresLegalVerification,
      parcelCount: products.parcelCount,
      categorySlug: productCategories.slug,
      // Snapshotted onto the order so the VIP rule can tell a new firearm from a
      // second-hand one after the fact (state is a tag since story 11.1).
      tagSlugs: productTagSlugs,
      legalCategory: legalCategories.category,
    })
    .from(cartItems)
    .innerJoin(productVariants, eq(cartItems.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
    .leftJoin(legalCategories, eq(products.legalCategoryId, legalCategories.id))
    .where(eq(cartItems.userId, userId))
    .orderBy(asc(cartItems.addedAt))

  const artworkRows = await db
    .select({
      id: artworkCartItems.id,
      addedAt: artworkCartItems.addedAt,
      priceHtAtTime: artworkCartItems.priceHtAtTime,
      printId: artworkPrints.id,
      printDesignation: artworkPrints.printDesignation,
      formatId: artworkPrints.formatId,
      artworkId: artworks.id,
      title: artworks.title,
      vatPct: artworks.vatPct,
      marginPct: products.marginPct,
      categorySlug: productCategories.slug,
    })
    .from(artworkCartItems)
    .innerJoin(artworkPrints, eq(artworkCartItems.printId, artworkPrints.id))
    .innerJoin(artworks, eq(artworkPrints.artworkId, artworks.id))
    .innerJoin(products, eq(artworks.productId, products.id))
    .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
    // A lapsed hold is gone from the cart at once, before the sweep frees the print.
    .where(and(eq(artworkCartItems.userId, userId), printHoldActive()))
    .orderBy(asc(artworkCartItems.addedAt))

  const discountFor = (lineHt: number, marginPct: string | null, categorySlug: string) =>
    isVip ? calculateVipDiscount(lineHt, Number(marginPct ?? 0), categorySlug) : { discountPct: 0, discountAmount: 0 }

  const items: CartProductLine[] = productRows.map((r) => {
    const unitPriceHt = Number(r.priceHtAtTime)
    const vatPct = Number(r.vatPct ?? 0)
    const lineHt = round2(unitPriceHt * r.qty)
    const { discountPct, discountAmount } = discountFor(lineHt, r.marginPct, r.categorySlug)
    return {
      id: r.id,
      variantId: r.variantId,
      productId: r.productId,
      name: r.name,
      sku: r.sku,
      skuVariant: r.skuVariant,
      finition: r.finition,
      munition: r.munition,
      couleur: r.couleur,
      qty: r.qty,
      stockQty: r.stockQty,
      vatPct,
      unitPriceHt,
      lineHt,
      discountPct,
      discountAmount,
      lineTtc: computePriceTtc(round2(lineHt - discountAmount), vatPct),
      categorySlug: r.categorySlug,
      tagSlugs: r.tagSlugs,
      legalCategory: r.legalCategory,
      requiresLegalVerification: r.requiresLegalVerification,
      parcelCount: r.parcelCount,
      heldUntil: r.reservedBy === userId && r.reservedUntil && r.reservedUntil > now ? r.reservedUntil : null,
    }
  })

  const artworkItems: CartArtworkLine[] = artworkRows.map((r) => {
    const unitPriceHt = Number(r.priceHtAtTime)
    const vatPct = Number(r.vatPct ?? 0)
    const lineHt = round2(unitPriceHt)
    const { discountPct, discountAmount } = discountFor(lineHt, r.marginPct, r.categorySlug)
    return {
      id: r.id,
      printId: r.printId,
      heldUntil: printHeldUntil(r.addedAt ?? now),
      artworkId: r.artworkId,
      title: r.title,
      printDesignation: r.printDesignation,
      formatId: r.formatId,
      categorySlug: r.categorySlug,
      vatPct,
      unitPriceHt,
      lineHt,
      discountPct,
      discountAmount,
      lineTtc: computePriceTtc(round2(lineHt - discountAmount), vatPct),
    }
  })

  const allLines = [...items, ...artworkItems]
  const subtotalHt = round2(allLines.reduce((sum, l) => sum + l.lineHt, 0))
  const vipDiscountAmount = round2(allLines.reduce((sum, l) => sum + l.discountAmount, 0))
  const itemCount = items.reduce((sum, l) => sum + l.qty, 0) + artworkItems.length

  // Priced on the net (VIP-discounted) lines, but the discount itself never
  // touches shipping (story 12.3).
  const shipping = computeShippingCost(shippableLinesOf(items, artworkItems), await loadShippingRates())

  // The VAT is computed by rate over the whole cart, the way the Henrri invoice
  // computes it (story 12.6): `lineTtc` is shown per line, but the total may
  // differ from their sum by a cent.
  const totals = computeVatTotals([
    ...allLines.map((l) => ({ priceHt: round2(l.lineHt - l.discountAmount), vatPct: l.vatPct })),
    ...shipping.portions,
  ])

  return {
    isVip,
    items,
    artworkItems,
    summary: {
      itemCount,
      subtotalHt,
      vipDiscountAmount,
      vatAmount: totals.vatAmount,
      totalTtc: totals.totalTtc,
      shipping,
    },
  }
}

/** What changed on a cart line since it was added (story 12.9d), as the checkout reports it. */
export type CartChange =
  | { kind: "price_changed"; lineId: string; name: string; previousPriceHt: number; priceHt: number }
  /** Unpublished, or now reserved for pros: taken out of the cart. */
  | { kind: "unavailable"; lineId: string; name: string }
  /** Category A is sold to pros only, by quote (Franck, 2026-10-22): taken out of the cart. */
  | { kind: "category_a"; lineId: string; name: string }

/** Why a product can no longer be bought from the cart, if it cannot. */
function blockedKind(line: { published: boolean | null; audience: string; legalCategory: string | null }) {
  if (!line.published || line.audience !== "public") return "unavailable" as const
  if (line.legalCategory === "A") return "category_a" as const
  return null
}

/**
 * Bring the cart in line with the catalogue as it is NOW (story 12.9d, security
 * audit): a line whose product was unpublished, reserved for pros or is of
 * category A leaves the cart — its unique-piece hold or print released — and a
 * line whose price moved takes the new price. Returns what changed, so the
 * checkout can refuse the order and show it: the customer confirms again.
 */
export async function reconcileCart(userId: string): Promise<CartChange[]> {
  const productLines = await db
    .select({
      id: cartItems.id,
      variantId: cartItems.variantId,
      priceHtAtTime: cartItems.priceHtAtTime,
      productPriceHt: products.priceHt,
      priceDeltaHt: productVariants.priceDeltaHt,
      name: products.name,
      published: products.published,
      audience: products.audience,
      legalCategory: legalCategories.category,
    })
    .from(cartItems)
    .innerJoin(productVariants, eq(cartItems.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .leftJoin(legalCategories, eq(products.legalCategoryId, legalCategories.id))
    .where(eq(cartItems.userId, userId))
    .orderBy(asc(cartItems.addedAt))

  const printLines = await db
    .select({
      id: artworkCartItems.id,
      printId: artworkCartItems.printId,
      priceHtAtTime: artworkCartItems.priceHtAtTime,
      printPriceHt: artworkPrints.priceHtUnit,
      name: artworks.title,
      published: products.published,
      audience: products.audience,
    })
    .from(artworkCartItems)
    .innerJoin(artworkPrints, eq(artworkCartItems.printId, artworkPrints.id))
    .innerJoin(artworks, eq(artworkPrints.artworkId, artworks.id))
    .innerJoin(products, eq(artworks.productId, products.id))
    .where(and(eq(artworkCartItems.userId, userId), printHoldActive()))
    .orderBy(asc(artworkCartItems.addedAt))

  const changes: CartChange[] = []
  await db.transaction(async (tx) => {
    for (const line of productLines) {
      const blocked = blockedKind(line)
      if (blocked) {
        await tx.delete(cartItems).where(eq(cartItems.id, line.id))
        await releaseUniquePiece(line.variantId, userId, tx)
        changes.push({ kind: blocked, lineId: line.id, name: line.name })
        continue
      }
      const priceHt = round2(Number(line.productPriceHt) + Number(line.priceDeltaHt ?? 0))
      const previousPriceHt = Number(line.priceHtAtTime)
      if (priceHt !== previousPriceHt) {
        await tx
          .update(cartItems)
          .set({ priceHtAtTime: priceHt.toFixed(2), updatedAt: new Date() })
          .where(eq(cartItems.id, line.id))
        changes.push({ kind: "price_changed", lineId: line.id, name: line.name, previousPriceHt, priceHt })
      }
    }
    for (const line of printLines) {
      const blocked = blockedKind({ ...line, legalCategory: null })
      if (blocked) {
        await tx.delete(artworkCartItems).where(eq(artworkCartItems.id, line.id))
        await releasePrintFromCart(line.printId, tx)
        changes.push({ kind: blocked, lineId: line.id, name: line.name })
        continue
      }
      const priceHt = Number(line.printPriceHt)
      const previousPriceHt = Number(line.priceHtAtTime)
      if (priceHt !== previousPriceHt) {
        await tx
          .update(artworkCartItems)
          .set({ priceHtAtTime: line.printPriceHt, updatedAt: new Date() })
          .where(eq(artworkCartItems.id, line.id))
        changes.push({ kind: "price_changed", lineId: line.id, name: line.name, previousPriceHt, priceHt })
      }
    }
  })
  return changes
}
