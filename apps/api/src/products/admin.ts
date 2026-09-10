import {
  computeProfitability,
  createProductSchema,
  type ProductVariantInput,
  updateProductSchema,
  uuidParamSchema,
} from "@armurier/shared"
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import { db } from "../db/client.js"
import {
  ancientWeapons,
  artworks,
  cartItems,
  legalCategories,
  orderItems,
  productCategories,
  products,
  productTags,
  productVariants,
  tags,
} from "../db/schema.js"
import { env } from "../env.js"
import { validationError } from "../http.js"
import { deleteMediaForOwner } from "../media/service.js"
import { beneficiaryOfProduct } from "../payouts/index.js"
import { sanitizeRichTextHtml } from "../sanitize.js"

type DbExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db

/**
 * Products that back a Gun Art piece or a collection weapon are edited through
 * THEIR OWN screens, which know about editions and provenance. Letting them
 * through the generic product form would offer an admin a way to desynchronise
 * the pair.
 */
const GENERIC_ONLY = sql`not exists (select 1 from ${artworks} where ${artworks.productId} = ${products.id})
  and not exists (select 1 from ${ancientWeapons} where ${ancientWeapons.productId} = ${products.id})`

async function attachTags(productId: string, tagSlugs: string[], tx: DbExecutor = db) {
  await tx.delete(productTags).where(eq(productTags.productId, productId))
  if (tagSlugs.length === 0) return
  const rows = await tx.select({ id: tags.id }).from(tags).where(inArray(tags.slug, tagSlugs))
  if (rows.length === 0) return
  await tx
    .insert(productTags)
    .values(rows.map((t) => ({ productId, tagId: t.id })))
    .onConflictDoNothing()
}

/**
 * Reconcile the variant list sent by the form with what is in the database.
 *
 * A variant is never blindly wiped and re-created: its id travels through carts
 * and order lines. Rows the form still carries are updated, new ones inserted,
 * and a removal is refused when the variant is referenced — the admin is told to
 * empty its stock instead.
 */
async function syncVariants(productId: string, wanted: ProductVariantInput[], tx: DbExecutor) {
  const existing = await tx
    .select({ id: productVariants.id, skuVariant: productVariants.skuVariant })
    .from(productVariants)
    .where(eq(productVariants.productId, productId))

  const keptIds = new Set(wanted.map((v) => v.id).filter((id): id is string => Boolean(id)))
  const doomed = existing.filter((row) => !keptIds.has(row.id))

  for (const row of doomed) {
    const [inUse] = await tx
      .select({ id: orderItems.id })
      .from(orderItems)
      .where(eq(orderItems.variantId, row.id))
      .limit(1)
    if (inUse) {
      throw new VariantInUseError(row.skuVariant)
    }
    await tx.delete(cartItems).where(eq(cartItems.variantId, row.id))
    await tx.delete(productVariants).where(eq(productVariants.id, row.id))
  }

  for (const v of wanted) {
    const values = {
      productId,
      skuVariant: v.skuVariant,
      finition: v.finition,
      munition: v.munition,
      couleur: v.couleur,
      priceDeltaHt: v.priceDeltaHt.toFixed(2),
      stockQty: v.stockQty,
      updatedAt: new Date(),
    }
    if (v.id && existing.some((row) => row.id === v.id)) {
      await tx.update(productVariants).set(values).where(eq(productVariants.id, v.id))
    } else {
      await tx.insert(productVariants).values(values)
    }
  }
}

class VariantInUseError extends Error {
  constructor(readonly skuVariant: string) {
    super(`Variant ${skuVariant} is referenced by an order`)
  }
}

async function loadAdminProduct(id: string) {
  const [row] = await db
    .select({
      id: products.id,
      sku: products.sku,
      slug: products.slug,
      name: products.name,
      description: products.description,
      longDescription: products.longDescription,
      priceHt: products.priceHt,
      vatPct: products.vatPct,
      stockQty: products.stockQty,
      trackStock: products.trackStock,
      published: products.published,
      featured: products.featured,
      featuredImageUrl: products.featuredImageUrl,
      metaTitle: products.metaTitle,
      metaDescription: products.metaDescription,
      costPriceHt: products.costPrice,
      chargesPct: products.chargesPct,
      chargesAmountHt: products.chargesAmountHt,
      beneficiaryId: products.beneficiaryId,
      beneficiarySharePct: products.beneficiarySharePct,
      categorySlug: productCategories.slug,
      categoryName: productCategories.name,
      legalCategory: legalCategories.category,
    })
    .from(products)
    .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
    .leftJoin(legalCategories, eq(products.legalCategoryId, legalCategories.id))
    .where(and(eq(products.id, id), GENERIC_ONLY))
    .limit(1)
  if (!row) return null

  const beneficiary = row.beneficiaryId ? await beneficiaryOfProduct(id) : null
  const beneficiaryName = beneficiary?.name ?? null
  const beneficiaryShare = beneficiary ? Number(beneficiary.defaultSharePct) : null

  const [variants, tagRows] = await Promise.all([
    db
      .select({
        id: productVariants.id,
        skuVariant: productVariants.skuVariant,
        finition: productVariants.finition,
        munition: productVariants.munition,
        couleur: productVariants.couleur,
        priceDeltaHt: productVariants.priceDeltaHt,
        stockQty: productVariants.stockQty,
      })
      .from(productVariants)
      .where(eq(productVariants.productId, id))
      .orderBy(asc(productVariants.skuVariant)),
    db
      .select({ slug: tags.slug, name: tags.name, facet: tags.facet })
      .from(productTags)
      .innerJoin(tags, eq(tags.id, productTags.tagId))
      .where(eq(productTags.productId, id))
      .orderBy(asc(tags.displayOrder), asc(tags.name)),
  ])

  // ⚠️ Admin-only figures. No public route reads any of this.
  const profitability = computeProfitability({
    priceHt: Number(row.priceHt),
    costPriceHt: row.costPriceHt === null ? null : Number(row.costPriceHt),
    chargesPct: row.chargesPct === null ? null : Number(row.chargesPct),
    chargesAmountHt: row.chargesAmountHt === null ? null : Number(row.chargesAmountHt),
    defaultChargesPct: env.DEFAULT_CHARGES_PCT,
    beneficiarySharePct: row.beneficiarySharePct === null ? (beneficiaryShare ?? 0) : Number(row.beneficiarySharePct),
  })

  return {
    ...row,
    priceHt: Number(row.priceHt),
    vatPct: Number(row.vatPct ?? 20),
    costPriceHt: row.costPriceHt === null ? null : Number(row.costPriceHt),
    chargesPct: row.chargesPct === null ? null : Number(row.chargesPct),
    chargesAmountHt: row.chargesAmountHt === null ? null : Number(row.chargesAmountHt),
    beneficiarySharePct: row.beneficiarySharePct === null ? null : Number(row.beneficiarySharePct),
    beneficiaryName,
    profitability,
    variants: variants.map((v) => ({ ...v, priceDeltaHt: Number(v.priceDeltaHt) })),
    tags: tagRows,
    tagSlugs: tagRows.map((t) => t.slug),
  }
}

/** Admin CRUD over the armurerie catalogue (story 7.5a). */
export const adminProductRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  fastify.get("/", async (_request, reply) => {
    const rows = await db
      .select({
        id: products.id,
        sku: products.sku,
        slug: products.slug,
        name: products.name,
        priceHt: products.priceHt,
        stockQty: products.stockQty,
        published: products.published,
        featured: products.featured,
        featuredImageUrl: products.featuredImageUrl,
        categorySlug: productCategories.slug,
        categoryName: productCategories.name,
        legalCategory: legalCategories.category,
        variantCount: sql<number>`(select count(*)::int from ${productVariants} where ${productVariants.productId} = ${products.id})`,
      })
      .from(products)
      .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
      .leftJoin(legalCategories, eq(products.legalCategoryId, legalCategories.id))
      .where(GENERIC_ONLY)
      .orderBy(desc(products.featured), asc(products.name))
    return reply.send({ data: rows.map((r) => ({ ...r, priceHt: Number(r.priceHt) })) })
  })

  fastify.get("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const product = await loadAdminProduct(params.data.id)
    if (!product) return reply.code(404).send({ error: "NotFound", message: "Product not found" })
    return reply.send({ data: product })
  })

  fastify.post("/", async (request, reply) => {
    const parsed = createProductSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const { categorySlug, legalCategory, tagSlugs, variants, ...body } = parsed.data

    const [category] = await db
      .select({ id: productCategories.id })
      .from(productCategories)
      .where(eq(productCategories.slug, categorySlug))
      .limit(1)
    if (!category) {
      return reply.code(400).send({ error: "ValidationError", message: `Unknown category: ${categorySlug}` })
    }
    const [legal] = await db
      .select({ id: legalCategories.id })
      .from(legalCategories)
      .where(eq(legalCategories.category, legalCategory))
      .limit(1)
    if (!legal) {
      return reply.code(400).send({ error: "ValidationError", message: `Unknown legal category: ${legalCategory}` })
    }

    const [clash] = await db
      .select({ id: products.id })
      .from(products)
      .where(sql`${products.sku} = ${body.sku} or ${products.slug} = ${body.slug}`)
      .limit(1)
    if (clash) return reply.code(409).send({ error: "Conflict", message: "SKU or slug already used" })

    const productId = await db.transaction(async (tx) => {
      const [product] = await tx
        .insert(products)
        .values({
          sku: body.sku,
          slug: body.slug,
          name: body.name,
          description: body.description,
          longDescription: body.longDescription ? sanitizeRichTextHtml(body.longDescription) : undefined,
          categoryId: category.id,
          legalCategoryId: legal.id,
          priceHt: body.priceHt.toFixed(2),
          vatPct: body.vatPct.toFixed(2),
          stockQty: body.stockQty,
          trackStock: body.trackStock,
          // Derived, never taken from the form: a category B firearm requires
          // paperwork whatever an admin ticks.
          requiresLegalVerification: legalCategory !== "none",
          featuredImageUrl: body.featuredImageUrl,
          published: body.published,
          featured: body.featured,
          metaTitle: body.metaTitle,
          metaDescription: body.metaDescription,
          costPrice: body.costPriceHt?.toFixed(2) ?? null,
          chargesPct: body.chargesPct?.toFixed(2) ?? null,
          chargesAmountHt: body.chargesAmountHt?.toFixed(2) ?? null,
          beneficiaryId: body.beneficiaryId ?? null,
          beneficiarySharePct: body.beneficiarySharePct?.toFixed(2) ?? null,
        })
        .returning({ id: products.id })
      if (!product) throw new Error("Product insert returned no row")

      if (variants.length > 0) await syncVariants(product.id, variants, tx)
      await attachTags(product.id, tagSlugs, tx)
      return product.id
    })

    return reply.code(201).send({ data: await loadAdminProduct(productId) })
  })

  fastify.patch("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const parsed = updateProductSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))

    const existing = await loadAdminProduct(params.data.id)
    if (!existing) return reply.code(404).send({ error: "NotFound", message: "Product not found" })

    const { categorySlug, legalCategory, tagSlugs, variants, ...body } = parsed.data

    try {
      await db.transaction(async (tx) => {
        const patch: Record<string, unknown> = { updatedAt: new Date() }
        for (const key of [
          "name",
          "description",
          "stockQty",
          "trackStock",
          "featuredImageUrl",
          "published",
          "featured",
          "metaTitle",
          "metaDescription",
        ] as const) {
          if (body[key] !== undefined) patch[key] = body[key]
        }
        if (body.longDescription !== undefined) patch.longDescription = sanitizeRichTextHtml(body.longDescription)
        if (body.priceHt !== undefined) patch.priceHt = body.priceHt.toFixed(2)
        if (body.vatPct !== undefined) patch.vatPct = body.vatPct.toFixed(2)
        if (body.beneficiaryId !== undefined) patch.beneficiaryId = body.beneficiaryId
        for (const [key, column] of [
          ["costPriceHt", "costPrice"],
          ["chargesPct", "chargesPct"],
          ["chargesAmountHt", "chargesAmountHt"],
          ["beneficiarySharePct", "beneficiarySharePct"],
        ] as const) {
          const value = body[key]
          // `null` clears the override and puts the article back on the default;
          // `undefined` means the form did not touch the field at all.
          if (value !== undefined) patch[column] = value === null ? null : value.toFixed(2)
        }

        if (categorySlug) {
          const [category] = await tx
            .select({ id: productCategories.id })
            .from(productCategories)
            .where(eq(productCategories.slug, categorySlug))
            .limit(1)
          if (!category) throw new UnknownReferenceError(`Unknown category: ${categorySlug}`)
          patch.categoryId = category.id
        }
        if (legalCategory) {
          const [legal] = await tx
            .select({ id: legalCategories.id })
            .from(legalCategories)
            .where(eq(legalCategories.category, legalCategory))
            .limit(1)
          if (!legal) throw new UnknownReferenceError(`Unknown legal category: ${legalCategory}`)
          patch.legalCategoryId = legal.id
          patch.requiresLegalVerification = legalCategory !== "none"
        }

        await tx.update(products).set(patch).where(eq(products.id, params.data.id))
        if (variants !== undefined) await syncVariants(params.data.id, variants, tx)
        if (tagSlugs !== undefined) await attachTags(params.data.id, tagSlugs, tx)
      })
    } catch (err) {
      if (err instanceof VariantInUseError) {
        return reply.code(409).send({
          error: "Conflict",
          message: `Variant ${err.skuVariant} appears on an order and cannot be removed — set its stock to 0 instead`,
        })
      }
      if (err instanceof UnknownReferenceError) {
        return reply.code(400).send({ error: "ValidationError", message: err.message })
      }
      throw err
    }

    return reply.send({ data: await loadAdminProduct(params.data.id) })
  })

  /** DELETE /:id — refused as soon as the product appears on an order. */
  fastify.delete("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))

    const existing = await loadAdminProduct(params.data.id)
    if (!existing) return reply.code(404).send({ error: "NotFound", message: "Product not found" })

    const [ordered] = await db
      .select({ id: orderItems.id })
      .from(orderItems)
      .where(eq(orderItems.productId, params.data.id))
      .limit(1)
    if (ordered) {
      return reply.code(409).send({
        error: "Conflict",
        message: "This product appears on an order — unpublish it instead of deleting it",
      })
    }

    // No foreign key reaches the polymorphic media table — the cleanup is ours.
    await deleteMediaForOwner("product", params.data.id)
    await db.delete(products).where(eq(products.id, params.data.id))
    return reply.code(204).send()
  })
}

class UnknownReferenceError extends Error {}
