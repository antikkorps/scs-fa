import { calculateVipDiscount, computePriceTtc, round2 } from "@armurier/shared"
import { asc, eq } from "drizzle-orm"
import { db } from "../db/client.js"
import {
  artworkCartItems,
  artworkPrints,
  artworks,
  cartItems,
  legalCategories,
  productCategories,
  products,
  productVariants,
  users,
} from "../db/schema.js"

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
  legalCategory: string | null
  requiresLegalVerification: boolean
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
    subtotalHt: number
    vipDiscountAmount: number
    vatAmount: number
    totalTtc: number
  }
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
      categorySlug: productCategories.slug,
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
      legalCategory: r.legalCategory,
      requiresLegalVerification: r.requiresLegalVerification,
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
  const totalTtc = round2(allLines.reduce((sum, l) => sum + l.lineTtc, 0))
  const vatAmount = round2(totalTtc - (subtotalHt - vipDiscountAmount))
  const itemCount = items.reduce((sum, l) => sum + l.qty, 0) + artworkItems.length

  return {
    isVip,
    items,
    artworkItems,
    summary: { itemCount, subtotalHt, vipDiscountAmount, vatAmount, totalTtc },
  }
}
