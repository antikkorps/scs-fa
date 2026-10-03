import {
  calculateVipDiscount,
  computePriceTtc,
  computeShippingCost,
  requiresVirement,
  round2,
  type ShippableLine,
  type ShippingQuote,
} from "@armurier/shared"
import { asc, eq, sql } from "drizzle-orm"
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
}

export interface CartArtworkLine {
  id: string
  printId: string
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
    .where(eq(artworkCartItems.userId, userId))
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
  const goodsTtc = round2(allLines.reduce((sum, l) => sum + l.lineTtc, 0))
  const goodsVat = round2(goodsTtc - (subtotalHt - vipDiscountAmount))
  const itemCount = items.reduce((sum, l) => sum + l.qty, 0) + artworkItems.length

  // Priced on the net (VIP-discounted) lines, but the discount itself never
  // touches shipping (story 12.3).
  const shipping = computeShippingCost(shippableLinesOf(items, artworkItems), await loadShippingRates())

  return {
    isVip,
    items,
    artworkItems,
    summary: {
      itemCount,
      subtotalHt,
      vipDiscountAmount,
      vatAmount: round2(goodsVat + shipping.vatAmount),
      totalTtc: round2(goodsTtc + shipping.totalTtc),
      shipping,
    },
  }
}
