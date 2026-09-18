import {
  CROSS_SELL_ACCESSORY_CATEGORY_SLUGS,
  CROSS_SELL_SOURCE_CATEGORY_SLUGS,
  type CrossSellCandidate,
  type CrossSellSource,
  computePriceTtc,
  crossSellRejectionMessage,
  crossSellsUpdateSchema,
  displayableCrossSells,
  type LegalCategory,
  rejectCrossSell,
  uuidParamSchema,
} from "@armurier/shared"
import { and, asc, eq, inArray } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { db } from "../db/client.js"
import { auditLogs, legalCategories, productCategories, productCrossSells, products } from "../db/schema.js"
import { env } from "../env.js"
import { validationError } from "../http.js"

// Story 11.8 — cross-sell « fréquemment achetés ensemble ».
//
// ⚠️ Les associations sont saisies à la main. Le code ne prétend donc PAS
// garantir qu'un accessoire convient à une arme : les restrictions sont une note
// en texte libre sur la fiche (`accessoryRestrictionNotes`), que l'admin lit au
// moment de choisir. Ce qui est vérifié ici est mécanique — nature des deux
// articles et exigences administratives — et l'est deux fois : à la saisie, puis
// de nouveau à l'affichage, parce qu'une arme peut changer de catégorie légale
// après coup.

/** Les colonnes dont les règles partagées ont besoin, pour un article. */
const candidateColumns = {
  id: products.id,
  categorySlug: productCategories.slug,
  legalCategory: legalCategories.category,
  published: products.published,
  trackStock: products.trackStock,
  stockQty: products.stockQty,
}

type CandidateRow = {
  id: string
  categorySlug: string
  legalCategory: string | null
  published: boolean | null
  trackStock: boolean | null
  stockQty: number | null
}

/**
 * Un article sans catégorie légale renseignée est en vente libre (`none`), et un
 * stock non suivi est un stock toujours disponible : les règles partagées ne
 * connaissent pas le `null` de la base.
 */
function toCandidate(row: CandidateRow): CrossSellCandidate {
  return {
    id: row.id,
    categorySlug: row.categorySlug,
    legalCategory: (row.legalCategory ?? "none") as LegalCategory,
    published: row.published ?? false,
    trackStock: row.trackStock ?? false,
    stockQty: row.stockQty ?? 0,
  }
}

function toSource(row: CandidateRow): CrossSellSource {
  return {
    id: row.id,
    categorySlug: row.categorySlug,
    legalCategory: (row.legalCategory ?? "none") as LegalCategory,
  }
}

async function loadCandidateRow(id: string): Promise<CandidateRow | null> {
  const [row] = await db
    .select(candidateColumns)
    .from(products)
    .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
    .leftJoin(legalCategories, eq(products.legalCategoryId, legalCategories.id))
    .where(eq(products.id, id))
    .limit(1)
  return row ?? null
}

/** L'ordre voulu par l'admin, puis le nom : deux positions égales restent stables. */
const crossSellOrder = [asc(productCrossSells.position), asc(products.name)] as const

/**
 * Les suggestions d'une arme, telles que la fiche publique les montre.
 *
 * ⚠️ Rend systématiquement une liste vide quand le bloc est éteint : le drapeau
 * se lit ici, au plus près de la donnée, et non dans chaque appelant.
 */
export async function publicCrossSellsFor(productId: string, vatPct: number) {
  if (!env.CROSS_SELL_ENABLED) return []

  const sourceRow = await loadCandidateRow(productId)
  if (!sourceRow) return []

  const rows = await db
    .select({
      ...candidateColumns,
      slug: products.slug,
      name: products.name,
      description: products.description,
      priceHt: products.priceHt,
      vatPct: products.vatPct,
      featuredImageUrl: products.featuredImageUrl,
      categoryName: productCategories.name,
    })
    .from(productCrossSells)
    .innerJoin(products, eq(products.id, productCrossSells.accessoryId))
    .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
    .leftJoin(legalCategories, eq(products.legalCategoryId, legalCategories.id))
    .where(eq(productCrossSells.productId, productId))
    .orderBy(...crossSellOrder)

  return displayableCrossSells(
    toSource(sourceRow),
    rows.map((row) => ({ ...toCandidate(row), row })),
  ).map(({ row }) => {
    const priceHt = Number(row.priceHt)
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      priceHt,
      priceTtc: computePriceTtc(priceHt, Number(row.vatPct ?? vatPct)),
      featuredImageUrl: row.featuredImageUrl,
      category: { slug: row.categorySlug, name: row.categoryName },
    }
  })
}

/** Ce que l'écran d'administration affiche pour une association déjà posée. */
async function adminCrossSellsFor(productId: string) {
  const rows = await db
    .select({
      ...candidateColumns,
      slug: products.slug,
      name: products.name,
      sku: products.sku,
      priceHt: products.priceHt,
      featuredImageUrl: products.featuredImageUrl,
      categoryName: productCategories.name,
      position: productCrossSells.position,
    })
    .from(productCrossSells)
    .innerJoin(products, eq(products.id, productCrossSells.accessoryId))
    .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
    .leftJoin(legalCategories, eq(products.legalCategoryId, legalCategories.id))
    .where(eq(productCrossSells.productId, productId))
    .orderBy(...crossSellOrder)

  return rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    slug: row.slug,
    name: row.name,
    priceHt: Number(row.priceHt),
    featuredImageUrl: row.featuredImageUrl,
    category: { slug: row.categorySlug, name: row.categoryName },
    legalCategory: row.legalCategory,
    published: row.published,
    stockQty: row.stockQty,
    trackStock: row.trackStock,
    position: row.position,
  }))
}

/**
 * Routes d'administration, greffées sous `/api/admin/products`. Elles héritent
 * de l'authentification et du rôle posés par le plugin parent.
 */
export const adminProductCrossSellRoutes: FastifyPluginAsync = async (fastify) => {
  /** GET /:id/cross-sells — les suggestions posées, et de quoi les comprendre. */
  fastify.get("/:id/cross-sells", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))

    const sourceRow = await loadCandidateRow(params.data.id)
    if (!sourceRow) return reply.code(404).send({ error: "NotFound", message: "Product not found" })

    const source = toSource(sourceRow)
    const eligible = CROSS_SELL_SOURCE_CATEGORY_SLUGS.includes(source.categorySlug)

    // ⚠️ La note de restriction est rendue à l'écran au moment de choisir : c'est
    // le seul endroit où « cet accessoire est interdit sur cette arme » existe,
    // et c'est du texte libre qu'aucune règle ne sait lire.
    const [restrictions] = await db
      .select({
        hasAccessoryRestrictions: products.hasAccessoryRestrictions,
        accessoryRestrictionNotes: products.accessoryRestrictionNotes,
      })
      .from(products)
      .where(eq(products.id, params.data.id))
      .limit(1)

    return reply.send({
      data: {
        hasAccessoryRestrictions: restrictions?.hasAccessoryRestrictions ?? false,
        accessoryRestrictionNotes: restrictions?.accessoryRestrictionNotes ?? null,
        // Le drapeau voyage jusqu'à l'écran : préparer des associations sur un
        // bloc éteint est légitime, mais l'admin doit le savoir.
        enabled: env.CROSS_SELL_ENABLED,
        eligible,
        reason: eligible ? null : crossSellRejectionMessage("source-not-a-weapon"),
        legalCategory: source.legalCategory,
        items: await adminCrossSellsFor(params.data.id),
      },
    })
  })

  /**
   * GET /:id/cross-sell-options — les accessoires que CETTE arme peut proposer.
   *
   * La liste est déjà filtrée par les règles partagées : un accessoire refusé
   * n'apparaît pas, plutôt que d'être proposé puis rejeté à l'enregistrement.
   */
  fastify.get("/:id/cross-sell-options", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))

    const sourceRow = await loadCandidateRow(params.data.id)
    if (!sourceRow) return reply.code(404).send({ error: "NotFound", message: "Product not found" })
    const source = toSource(sourceRow)

    const rows = await db
      .select({
        ...candidateColumns,
        sku: products.sku,
        name: products.name,
        priceHt: products.priceHt,
        featuredImageUrl: products.featuredImageUrl,
        categoryName: productCategories.name,
      })
      .from(products)
      .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
      .leftJoin(legalCategories, eq(products.legalCategoryId, legalCategories.id))
      .where(
        and(inArray(productCategories.slug, [...CROSS_SELL_ACCESSORY_CATEGORY_SLUGS]), eq(products.published, true)),
      )
      .orderBy(asc(productCategories.displayOrder), asc(products.name))

    const data = rows
      .filter((row) => rejectCrossSell(source, toCandidate(row)) === null)
      .map((row) => ({
        id: row.id,
        sku: row.sku,
        name: row.name,
        priceHt: Number(row.priceHt),
        featuredImageUrl: row.featuredImageUrl,
        category: { slug: row.categorySlug, name: row.categoryName },
        legalCategory: row.legalCategory,
        stockQty: row.stockQty,
        trackStock: row.trackStock,
      }))

    return reply.send({ data })
  })

  /**
   * PUT /:id/cross-sells — remplace toute la liste, dans l'ordre reçu.
   *
   * Un seul refus possible et il est mécanique (article introuvable, arme
   * suggérée, formalités plus lourdes) : la compatibilité réelle reste la
   * responsabilité de l'admin, prévenu à l'écran par la note de restriction.
   */
  fastify.put("/:id/cross-sells", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const parsed = crossSellsUpdateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))

    const sourceRow = await loadCandidateRow(params.data.id)
    if (!sourceRow) return reply.code(404).send({ error: "NotFound", message: "Product not found" })
    const source = toSource(sourceRow)

    if (!CROSS_SELL_SOURCE_CATEGORY_SLUGS.includes(source.categorySlug)) {
      return reply.code(409).send({ error: "Conflict", message: crossSellRejectionMessage("source-not-a-weapon") })
    }

    const { accessoryIds } = parsed.data
    if (accessoryIds.length > 0) {
      const rows = await db
        .select(candidateColumns)
        .from(products)
        .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
        .leftJoin(legalCategories, eq(products.legalCategoryId, legalCategories.id))
        .where(inArray(products.id, accessoryIds))

      for (const id of accessoryIds) {
        const row = rows.find((r) => r.id === id)
        if (!row) {
          return reply.code(400).send({ error: "ValidationError", message: `Unknown product: ${id}` })
        }
        const rejection = rejectCrossSell(source, toCandidate(row))
        if (rejection) {
          return reply.code(409).send({ error: "Conflict", message: crossSellRejectionMessage(rejection) })
        }
      }
    }

    const before = (await adminCrossSellsFor(params.data.id)).map((i) => i.id)

    await db.transaction(async (tx) => {
      await tx.delete(productCrossSells).where(eq(productCrossSells.productId, params.data.id))
      if (accessoryIds.length > 0) {
        await tx.insert(productCrossSells).values(
          accessoryIds.map((accessoryId, index) => ({
            productId: params.data.id,
            accessoryId,
            position: index,
          })),
        )
      }
      // Une suggestion est une décision commerciale sur une arme : la trace dit
      // qui l'a prise, et ce qu'elle a remplacé.
      await tx.insert(auditLogs).values({
        userId: request.user.sub,
        userRole: "admin",
        entityType: "product",
        entityId: params.data.id,
        action: "cross_sell.updated",
        oldValue: { accessoryIds: before },
        newValue: { accessoryIds },
      })
    })

    return reply.send({ data: await adminCrossSellsFor(params.data.id) })
  })
}
