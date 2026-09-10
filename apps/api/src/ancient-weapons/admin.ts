import { createAncientWeaponSchema, updateAncientWeaponSchema, uuidParamSchema } from "@armurier/shared"
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import { db } from "../db/client.js"
import {
  ancientWeapons,
  legalCategories,
  productCategories,
  products,
  productTags,
  productVariants,
  tags,
} from "../db/schema.js"
import { validationError } from "../http.js"
import { deleteMediaForOwner } from "../media/service.js"
import { sanitizeRichTextHtml } from "../sanitize.js"

/**
 * The single variant every collection weapon gets. The cart is keyed on
 * `variantId`, so a product with no variant simply cannot be bought — yet a
 * collection piece has nothing to choose between. Creating one implicit variant
 * keeps the whole purchase tunnel (phases 3, 4 and 6) working untouched, which
 * is exactly what "same journey as a new firearm" requires.
 */
const uniqueVariantSku = (sku: string) => `${sku}-PU`
const UNIQUE_VARIANT_LABEL = "Pièce unique"

type DbExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db

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

async function loadAdminWeapon(productId: string) {
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
      published: products.published,
      featured: products.featured,
      featuredImageUrl: products.featuredImageUrl,
      categorySlug: productCategories.slug,
      legalCategory: legalCategories.category,
      period: ancientWeapons.period,
      periodStartYear: ancientWeapons.periodStartYear,
      periodEndYear: ancientWeapons.periodEndYear,
      provenance: ancientWeapons.provenance,
      makerName: ancientWeapons.makerName,
      makerLocation: ancientWeapons.makerLocation,
      condition: ancientWeapons.condition,
      conditionDescription: ancientWeapons.conditionDescription,
      restorationInfo: ancientWeapons.restorationInfo,
      isAuthentic: ancientWeapons.isAuthentic,
      expertName: ancientWeapons.expertName,
      expertDate: ancientWeapons.expertDate,
      historicalInfo: ancientWeapons.historicalInfo,
      isUnique: ancientWeapons.isUnique,
    })
    .from(products)
    .innerJoin(ancientWeapons, eq(ancientWeapons.productId, products.id))
    .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
    .leftJoin(legalCategories, eq(products.legalCategoryId, legalCategories.id))
    .where(eq(products.id, productId))
    .limit(1)

  if (!row) return null

  const tagRows = await db
    .select({ slug: tags.slug, name: tags.name, facet: tags.facet })
    .from(productTags)
    .innerJoin(tags, eq(tags.id, productTags.tagId))
    .where(eq(productTags.productId, productId))
    .orderBy(asc(tags.displayOrder), asc(tags.name))

  return { ...row, priceHt: Number(row.priceHt), tags: tagRows }
}

/** Admin CRUD over the products ↔ ancient_weapons pair. */
export const adminAncientWeaponRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  // GET / — every collection weapon, published or not (unlike the public list).
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
        period: ancientWeapons.period,
        makerName: ancientWeapons.makerName,
        condition: ancientWeapons.condition,
        isAuthentic: ancientWeapons.isAuthentic,
      })
      .from(products)
      .innerJoin(ancientWeapons, eq(ancientWeapons.productId, products.id))
      .orderBy(desc(products.createdAt))

    return reply.code(200).send({ data: rows.map((r) => ({ ...r, priceHt: Number(r.priceHt) })) })
  })

  fastify.get("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))

    const weapon = await loadAdminWeapon(params.data.id)
    if (!weapon) return reply.code(404).send({ error: "NotFound", message: "Collection weapon not found" })
    return reply.code(200).send({ data: weapon })
  })

  // POST / — create the product, its historical record, its single variant and
  // its tags in one transaction. Partial creation would leave an unbuyable or
  // untagged piece behind, so it is all-or-nothing.
  fastify.post("/", async (request, reply) => {
    const parsed = createAncientWeaponSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))

    const { categorySlug, legalCategory, tagSlugs, ...body } = parsed.data

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
    if (clash) {
      return reply.code(409).send({ error: "Conflict", message: "SKU or slug already used" })
    }

    const productId = await db.transaction(async (tx) => {
      const [product] = await tx
        .insert(products)
        .values({
          sku: body.sku,
          slug: body.slug,
          name: body.name,
          description: body.description,
          // Rendered with v-html on the product page, so it is sanitised here on
          // the way in — that is the invariant the front relies on.
          longDescription: body.longDescription ? sanitizeRichTextHtml(body.longDescription) : undefined,
          categoryId: category.id,
          legalCategoryId: legal.id,
          priceHt: body.priceHt.toFixed(2),
          // A collection piece exists in one copy — that is the whole point.
          stockQty: 1,
          trackStock: true,
          requiresLegalVerification: legalCategory !== "none",
          featuredImageUrl: body.featuredImageUrl,
          published: body.published,
        })
        .returning({ id: products.id })

      await tx.insert(ancientWeapons).values({
        productId: product.id,
        period: body.period,
        periodStartYear: body.periodStartYear,
        periodEndYear: body.periodEndYear,
        provenance: body.provenance,
        makerName: body.makerName,
        makerLocation: body.makerLocation,
        condition: body.condition,
        conditionDescription: body.conditionDescription,
        restorationInfo: body.restorationInfo,
        isAuthentic: body.isAuthentic,
        expertName: body.expertName,
        expertDate: body.expertDate,
        historicalInfo: body.historicalInfo ?? {},
        isUnique: true,
      })

      await tx.insert(productVariants).values({
        productId: product.id,
        skuVariant: uniqueVariantSku(body.sku),
        // chk_variant_attrs requires at least one attribute; the label carries
        // the meaning here since there is nothing to choose between.
        finition: UNIQUE_VARIANT_LABEL,
        stockQty: 1,
        priceDeltaHt: "0",
      })

      await attachTags(product.id, tagSlugs, tx)
      return product.id
    })

    const weapon = await loadAdminWeapon(productId)
    return reply.code(201).send({ data: weapon })
  })

  fastify.patch("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))

    const parsed = updateAncientWeaponSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))

    const existing = await loadAdminWeapon(params.data.id)
    if (!existing) return reply.code(404).send({ error: "NotFound", message: "Collection weapon not found" })

    const { legalCategory, tagSlugs, ...body } = parsed.data

    await db.transaction(async (tx) => {
      const productPatch: Record<string, unknown> = { updatedAt: new Date() }
      if (body.name !== undefined) productPatch.name = body.name
      if (body.description !== undefined) productPatch.description = body.description
      if (body.longDescription !== undefined) {
        productPatch.longDescription = sanitizeRichTextHtml(body.longDescription)
      }
      if (body.priceHt !== undefined) productPatch.priceHt = body.priceHt.toFixed(2)
      if (body.featuredImageUrl !== undefined) productPatch.featuredImageUrl = body.featuredImageUrl
      if (body.published !== undefined) productPatch.published = body.published

      if (legalCategory) {
        const [legal] = await tx
          .select({ id: legalCategories.id })
          .from(legalCategories)
          .where(eq(legalCategories.category, legalCategory))
          .limit(1)
        if (legal) {
          productPatch.legalCategoryId = legal.id
          productPatch.requiresLegalVerification = legalCategory !== "none"
        }
      }

      await tx.update(products).set(productPatch).where(eq(products.id, params.data.id))

      const weaponPatch: Record<string, unknown> = { updatedAt: new Date() }
      for (const key of [
        "period",
        "periodStartYear",
        "periodEndYear",
        "provenance",
        "makerName",
        "makerLocation",
        "condition",
        "conditionDescription",
        "restorationInfo",
        "isAuthentic",
        "expertName",
        "expertDate",
        "historicalInfo",
      ] as const) {
        if (body[key] !== undefined) weaponPatch[key] = body[key]
      }
      if (Object.keys(weaponPatch).length > 1) {
        await tx.update(ancientWeapons).set(weaponPatch).where(eq(ancientWeapons.productId, params.data.id))
      }

      if (tagSlugs) await attachTags(params.data.id, tagSlugs, tx)
    })

    return reply.code(200).send({ data: await loadAdminWeapon(params.data.id) })
  })

  // DELETE /:id — removes the product; ancient_weapons, variants and tags all
  // cascade. Refused once the piece has been reserved or sold, so a purchase
  // trail can never be erased from under an order.
  fastify.delete("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))

    const [variant] = await db
      .select({ stockQty: productVariants.stockQty, reservedBy: productVariants.reservedBy })
      .from(productVariants)
      .where(eq(productVariants.productId, params.data.id))
      .limit(1)

    if (variant && ((variant.stockQty ?? 0) === 0 || variant.reservedBy)) {
      return reply.code(409).send({
        error: "Conflict",
        message: "This piece is sold or currently held by a customer — unpublish it instead",
      })
    }

    const deleted = await db
      .delete(products)
      .where(
        and(
          eq(products.id, params.data.id),
          sql`exists (select 1 from ancient_weapons aw where aw.product_id = ${products.id})`,
        ),
      )
      .returning({ id: products.id })

    if (deleted.length === 0) {
      return reply.code(404).send({ error: "NotFound", message: "Collection weapon not found" })
    }
    // No foreign key reaches the polymorphic media table — the cleanup is ours.
    await deleteMediaForOwner("product", params.data.id)
    return reply.code(204).send()
  })
}
