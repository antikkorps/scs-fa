import {
  type ArtworkFormat,
  calculateArtworkPrice,
  computeProfitability,
  createArtworkSchema,
  updateArtworkSchema,
  uuidParamSchema,
  validateArtworkPriceGrid,
} from "@armurier/shared"
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import { db } from "../db/client.js"
import {
  artists,
  artworkPrints,
  artworkSeries,
  artworks,
  legalCategories,
  productCategories,
  products,
} from "../db/schema.js"
import { env } from "../env.js"
import { validationError } from "../http.js"
import { deleteMediaForOwner } from "../media/service.js"
import { beneficiaryOfArtist } from "../payouts/index.js"
import { sanitizeRichTextHtml } from "../sanitize.js"

type DbExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db

/** Statuses that mean a print is spoken for; an artwork holding one cannot be deleted. */
const CLAIMED = ["in_cart", "reserved", "sold"] as const

/**
 * The format a freshly numbered print is created in: the smallest of the grid.
 *
 * ⚠️ Known tension, stated rather than hidden. `artwork_prints.format_id` fixes a
 * format at creation, while the client's rule (story 11.7) is that the 25 numbers
 * are shared ACROSS formats and the buyer picks their size. Until that is
 * settled, the edition is numbered in the entry format — exactly what the seed
 * already did — and an admin can re-format any still-available print, which
 * re-prices it. Nothing here presumes the tension is resolved.
 */
function entryFormat(formats: ArtworkFormat[]): ArtworkFormat {
  return [...formats].sort((a, b) => a.priceFactor - b.priceFactor)[0] as ArtworkFormat
}

function priceGridError(basePriceHt: number, priceIncrementHt: number, editionLimit: number, formats: ArtworkFormat[]) {
  const { valid, overlaps } = validateArtworkPriceGrid(basePriceHt, priceIncrementHt, editionLimit, formats)
  if (valid) return null
  // Story 11.7's guard rail, finally applied where an artwork is saved. The
  // remedies travel with the refusal: a bare "invalid" would send the admin
  // back to the simulator to work out what to change.
  return {
    error: "ValidationError",
    message: "A smaller format would out-price a bigger one",
    issues: overlaps.map((o) => ({
      path: "availableFormats",
      message: `« ${o.lowerFormatName} » monte à ${o.lowerMaxPriceHt} € HT alors que « ${o.upperFormatName} » démarre à ${o.upperMinPriceHt} € HT. Incrément ≤ ${o.maxIncrementHt} € HT, ou facteur de « ${o.upperFormatName} » ≥ ${o.minUpperPriceFactor}.`,
    })),
  }
}

async function loadAdminArtwork(id: string) {
  const [row] = await db
    .select({
      id: artworks.id,
      productId: artworks.productId,
      slug: artworks.slug,
      sku: artworks.sku,
      title: artworks.title,
      description: artworks.description,
      longDescription: artworks.longDescription,
      artistId: artworks.artistId,
      artistName: artists.name,
      seriesId: artworks.seriesId,
      seriesTitle: artworkSeries.title,
      seriesOrder: artworks.seriesOrder,
      editionLimit: artworks.editionLimit,
      editionYear: artworks.editionYear,
      availableFormats: artworks.availableFormats,
      basePriceHt: artworks.basePriceHt,
      priceIncrementHt: artworks.priceIncrementHt,
      vatPct: artworks.vatPct,
      costPriceHt: artworks.costPriceHt,
      chargesPct: artworks.chargesPct,
      chargesAmountHt: artworks.chargesAmountHt,
      beneficiarySharePct: artworks.beneficiarySharePct,
      orientation: artworks.orientation,
      includeCertificate: artworks.includeCertificate,
      featuredImageUrl: artworks.featuredImageUrl,
      published: artworks.published,
      featured: artworks.featured,
      metaTitle: artworks.metaTitle,
      metaDescription: artworks.metaDescription,
    })
    .from(artworks)
    .leftJoin(artists, eq(artworks.artistId, artists.id))
    .leftJoin(artworkSeries, eq(artworks.seriesId, artworkSeries.id))
    .where(eq(artworks.id, id))
    .limit(1)
  if (!row) return null

  const prints = await db
    .select({
      id: artworkPrints.id,
      printNumber: artworkPrints.printNumber,
      printDesignation: artworkPrints.printDesignation,
      formatId: artworkPrints.formatId,
      status: artworkPrints.status,
      priceHtUnit: artworkPrints.priceHtUnit,
    })
    .from(artworkPrints)
    .where(eq(artworkPrints.artworkId, id))
    .orderBy(asc(artworkPrints.printNumber))

  // The beneficiary of an artwork is the beneficiary of its ARTIST; only the
  // rate is renegotiable piece by piece (story 11.10).
  const beneficiary = row.artistId ? await beneficiaryOfArtist(row.artistId) : null
  const sharePct =
    row.beneficiarySharePct === null
      ? beneficiary
        ? Number(beneficiary.defaultSharePct)
        : 0
      : Number(row.beneficiarySharePct)

  // Profitability is quoted on the DEAREST print of the edition: it is the only
  // single figure that is not arbitrary, and the admin sees which one it is.
  const dearest = prints.length > 0 ? Math.max(...prints.map((p) => Number(p.priceHtUnit))) : Number(row.basePriceHt)

  return {
    ...row,
    basePriceHt: Number(row.basePriceHt),
    priceIncrementHt: Number(row.priceIncrementHt),
    vatPct: Number(row.vatPct ?? 20),
    costPriceHt: row.costPriceHt === null ? null : Number(row.costPriceHt),
    chargesPct: row.chargesPct === null ? null : Number(row.chargesPct),
    chargesAmountHt: row.chargesAmountHt === null ? null : Number(row.chargesAmountHt),
    beneficiarySharePct: row.beneficiarySharePct === null ? null : Number(row.beneficiarySharePct),
    beneficiaryName: beneficiary?.name ?? null,
    profitability: {
      ...computeProfitability({
        priceHt: dearest,
        costPriceHt: row.costPriceHt === null ? null : Number(row.costPriceHt),
        chargesPct: row.chargesPct === null ? null : Number(row.chargesPct),
        chargesAmountHt: row.chargesAmountHt === null ? null : Number(row.chargesAmountHt),
        defaultChargesPct: env.DEFAULT_CHARGES_PCT,
        beneficiarySharePct: sharePct,
      }),
      /** Which print the figures above describe. */
      basedOnPriceHt: dearest,
    },
    prints: prints.map((p) => ({ ...p, priceHt: Number(p.priceHtUnit), priceHtUnit: undefined })),
  }
}

/**
 * Re-price the prints that are still available.
 *
 * A sold or reserved print keeps the price it was bought at — that is what the
 * buyer was promised and what the order snapshot records. Only what is still on
 * the shelf follows a change of base price, increment or format factors.
 */
async function repriceAvailablePrints(
  artworkId: string,
  basePriceHt: number,
  priceIncrementHt: number,
  editionLimit: number,
  formats: ArtworkFormat[],
  tx: DbExecutor = db,
) {
  const rows = await tx
    .select({ id: artworkPrints.id, printNumber: artworkPrints.printNumber, formatId: artworkPrints.formatId })
    .from(artworkPrints)
    .where(and(eq(artworkPrints.artworkId, artworkId), eq(artworkPrints.status, "available")))

  for (const p of rows) {
    const format = formats.find((f) => f.id === p.formatId) ?? entryFormat(formats)
    const priceHt = calculateArtworkPrice(basePriceHt, priceIncrementHt, editionLimit, p.printNumber, format)
    await tx
      .update(artworkPrints)
      .set({ formatId: format.id, priceHtUnit: priceHt.toFixed(2), updatedAt: new Date() })
      .where(eq(artworkPrints.id, p.id))
  }
}

/** Admin CRUD over the products ↔ artworks pair, plus the numbered prints. */
export const adminArtworkRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  // GET / — every artwork, published or not, with what an edition is worth today.
  fastify.get("/", async (_request, reply) => {
    const rows = await db
      .select({
        id: artworks.id,
        slug: artworks.slug,
        sku: artworks.sku,
        title: artworks.title,
        published: artworks.published,
        featured: artworks.featured,
        editionLimit: artworks.editionLimit,
        editionYear: artworks.editionYear,
        featuredImageUrl: artworks.featuredImageUrl,
        artistName: artists.name,
        seriesTitle: artworkSeries.title,
        availableCount: sql<number>`count(${artworkPrints.id}) filter (where ${artworkPrints.status} = 'available')::int`,
        soldCount: sql<number>`count(${artworkPrints.id}) filter (where ${artworkPrints.status} = 'sold')::int`,
      })
      .from(artworks)
      .leftJoin(artworkPrints, eq(artworkPrints.artworkId, artworks.id))
      .leftJoin(artists, eq(artworks.artistId, artists.id))
      .leftJoin(artworkSeries, eq(artworks.seriesId, artworkSeries.id))
      .groupBy(artworks.id, artists.name, artworkSeries.title)
      .orderBy(desc(artworks.featured), desc(artworks.createdAt))
    return reply.send({ data: rows })
  })

  fastify.get("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const artwork = await loadAdminArtwork(params.data.id)
    if (!artwork) return reply.code(404).send({ error: "NotFound", message: "Artwork not found" })
    return reply.send({ data: artwork })
  })

  /**
   * POST / — create an artwork, its backing product and its numbered edition.
   *
   * The product is what the cart and the order tunnel key on, so it is created
   * in the same transaction: an artwork without one could never be bought.
   */
  fastify.post("/", async (request, reply) => {
    const parsed = createArtworkSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const body = parsed.data

    const gridError = priceGridError(body.basePriceHt, body.priceIncrementHt, body.editionLimit, body.availableFormats)
    if (gridError) return reply.code(400).send(gridError)

    const [gunArt] = await db
      .select({ id: productCategories.id })
      .from(productCategories)
      .where(eq(productCategories.slug, "gun-art"))
      .limit(1)
    const [legalNone] = await db
      .select({ id: legalCategories.id })
      .from(legalCategories)
      .where(eq(legalCategories.category, "none"))
      .limit(1)
    if (!gunArt || !legalNone) {
      return reply.code(500).send({ error: "ServerError", message: "Missing reference data (gun-art / none)" })
    }

    const [clash] = await db
      .select({ id: artworks.id })
      .from(artworks)
      .where(sql`${artworks.slug} = ${body.slug} or ${artworks.sku} = ${body.sku}`)
      .limit(1)
    if (clash) return reply.code(409).send({ error: "Conflict", message: "SKU or slug already used" })

    const missing = await missingArtworkReference(body.artistId, body.seriesId)
    if (missing) return reply.code(400).send({ error: "ValidationError", message: missing })

    const format = entryFormat(body.availableFormats)

    const artworkId = await db.transaction(async (tx) => {
      const [product] = await tx
        .insert(products)
        .values({
          sku: `ART-${body.sku}`,
          slug: `art-${body.slug}`,
          name: body.title,
          description: body.description,
          categoryId: gunArt.id,
          legalCategoryId: legalNone.id,
          priceHt: body.basePriceHt.toFixed(2),
          vatPct: body.vatPct.toFixed(2),
          // A limited edition is not stock-tracked at product level: the prints are.
          requiresLegalVerification: false,
          published: body.published,
        })
        .returning({ id: products.id })
      if (!product) throw new Error("Product insert returned no row")

      const [artwork] = await tx
        .insert(artworks)
        .values({
          productId: product.id,
          slug: body.slug,
          sku: body.sku,
          title: body.title,
          description: body.description,
          // Rendered with v-html on the artwork page, so it is sanitised on the
          // way in — the same invariant the product long description relies on.
          longDescription: body.longDescription ? sanitizeRichTextHtml(body.longDescription) : undefined,
          artistId: body.artistId ?? null,
          seriesId: body.seriesId ?? null,
          seriesOrder: body.seriesOrder,
          editionLimit: body.editionLimit,
          editionYear: body.editionYear ?? null,
          availableFormats: body.availableFormats,
          basePriceHt: body.basePriceHt.toFixed(2),
          priceIncrementHt: body.priceIncrementHt.toFixed(2),
          vatPct: body.vatPct.toFixed(2),
          orientation: body.orientation,
          includeCertificate: body.includeCertificate,
          featuredImageUrl: body.featuredImageUrl,
          published: body.published,
          featured: body.featured,
          metaTitle: body.metaTitle,
          metaDescription: body.metaDescription,
          costPriceHt: body.costPriceHt?.toFixed(2) ?? null,
          chargesPct: body.chargesPct?.toFixed(2) ?? null,
          chargesAmountHt: body.chargesAmountHt?.toFixed(2) ?? null,
          beneficiarySharePct: body.beneficiarySharePct?.toFixed(2) ?? null,
        })
        .returning({ id: artworks.id })
      if (!artwork) throw new Error("Artwork insert returned no row")

      await tx.insert(artworkPrints).values(
        Array.from({ length: body.editionLimit }, (_, i) => {
          const printNumber = i + 1
          return {
            artworkId: artwork.id,
            printNumber,
            totalPrints: body.editionLimit,
            printDesignation: `${printNumber}/${body.editionLimit}`,
            formatId: format.id,
            priceHtUnit: calculateArtworkPrice(
              body.basePriceHt,
              body.priceIncrementHt,
              body.editionLimit,
              printNumber,
              format,
            ).toFixed(2),
          }
        }),
      )

      return artwork.id
    })

    return reply.code(201).send({ data: await loadAdminArtwork(artworkId) })
  })

  fastify.patch("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const parsed = updateArtworkSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))

    const existing = await loadAdminArtwork(params.data.id)
    if (!existing) return reply.code(404).send({ error: "NotFound", message: "Artwork not found" })

    const body = parsed.data
    // The guard rail is checked against the grid AFTER the patch, not against
    // the fields the patch happens to carry — changing the increment alone can
    // break a grid whose factors were never touched.
    const basePriceHt = body.basePriceHt ?? existing.basePriceHt
    const priceIncrementHt = body.priceIncrementHt ?? existing.priceIncrementHt
    const formats = body.availableFormats ?? (existing.availableFormats as ArtworkFormat[])
    const gridError = priceGridError(basePriceHt, priceIncrementHt, existing.editionLimit, formats)
    if (gridError) return reply.code(400).send(gridError)

    const missing = await missingArtworkReference(body.artistId, body.seriesId)
    if (missing) return reply.code(400).send({ error: "ValidationError", message: missing })

    const pricingChanged =
      body.basePriceHt !== undefined || body.priceIncrementHt !== undefined || body.availableFormats !== undefined

    await db.transaction(async (tx) => {
      const patch: Record<string, unknown> = { updatedAt: new Date() }
      for (const key of [
        "title",
        "description",
        "artistId",
        "seriesId",
        "seriesOrder",
        "editionYear",
        "orientation",
        "includeCertificate",
        "featuredImageUrl",
        "published",
        "featured",
        "metaTitle",
        "metaDescription",
      ] as const) {
        if (body[key] !== undefined) patch[key] = body[key]
      }
      if (body.longDescription !== undefined) patch.longDescription = sanitizeRichTextHtml(body.longDescription)
      if (body.availableFormats !== undefined) patch.availableFormats = body.availableFormats
      if (body.basePriceHt !== undefined) patch.basePriceHt = body.basePriceHt.toFixed(2)
      if (body.priceIncrementHt !== undefined) patch.priceIncrementHt = body.priceIncrementHt.toFixed(2)
      if (body.vatPct !== undefined) patch.vatPct = body.vatPct.toFixed(2)
      for (const key of ["costPriceHt", "chargesPct", "chargesAmountHt", "beneficiarySharePct"] as const) {
        const value = body[key]
        // `null` clears the override; `undefined` means the form left it alone.
        if (value !== undefined) patch[key] = value === null ? null : value.toFixed(2)
      }

      await tx.update(artworks).set(patch).where(eq(artworks.id, params.data.id))

      // Keep the backing product in step with what the storefront shows.
      const productPatch: Record<string, unknown> = { updatedAt: new Date() }
      if (body.title !== undefined) productPatch.name = body.title
      if (body.description !== undefined) productPatch.description = body.description
      if (body.published !== undefined) productPatch.published = body.published
      if (body.basePriceHt !== undefined) productPatch.priceHt = body.basePriceHt.toFixed(2)
      if (body.vatPct !== undefined) productPatch.vatPct = body.vatPct.toFixed(2)
      if (Object.keys(productPatch).length > 1) {
        await tx.update(products).set(productPatch).where(eq(products.id, existing.productId))
      }

      if (pricingChanged) {
        await repriceAvailablePrints(params.data.id, basePriceHt, priceIncrementHt, existing.editionLimit, formats, tx)
      }
    })

    return reply.send({ data: await loadAdminArtwork(params.data.id) })
  })

  /**
   * PATCH /:id/prints/:printId — move a still-available print to another format.
   *
   * Refused on a print that is in a cart, reserved or sold: re-pricing under a
   * buyer is not an edit, it is a broken promise.
   */
  fastify.patch("/:id/prints/:printId", async (request, reply) => {
    const { id, printId } = request.params as { id: string; printId: string }
    const body = request.body as { formatId?: unknown }
    if (typeof body?.formatId !== "string") {
      return reply.code(400).send({ error: "ValidationError", message: "formatId is required" })
    }

    const artwork = await loadAdminArtwork(id)
    if (!artwork) return reply.code(404).send({ error: "NotFound", message: "Artwork not found" })

    const format = (artwork.availableFormats as ArtworkFormat[]).find((f) => f.id === body.formatId)
    if (!format) {
      return reply.code(400).send({ error: "ValidationError", message: `Unknown format: ${body.formatId}` })
    }

    const print = artwork.prints.find((p) => p.id === printId)
    if (!print) return reply.code(404).send({ error: "NotFound", message: "Print not found" })
    if (print.status !== "available") {
      return reply.code(409).send({ error: "Conflict", message: "Only an available print can be re-formatted" })
    }

    const priceHt = calculateArtworkPrice(
      artwork.basePriceHt,
      artwork.priceIncrementHt,
      artwork.editionLimit,
      print.printNumber,
      format,
    )
    await db
      .update(artworkPrints)
      .set({ formatId: format.id, priceHtUnit: priceHt.toFixed(2), updatedAt: new Date() })
      .where(eq(artworkPrints.id, printId))

    return reply.send({ data: await loadAdminArtwork(id) })
  })

  /**
   * DELETE /:id — removes the backing product; the artwork and its prints
   * cascade. Refused once any print is in a cart, reserved or sold, so a
   * purchase trail can never be erased from under an order.
   */
  fastify.delete("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))

    const [artwork] = await db
      .select({ id: artworks.id, productId: artworks.productId })
      .from(artworks)
      .where(eq(artworks.id, params.data.id))
      .limit(1)
    if (!artwork) return reply.code(404).send({ error: "NotFound", message: "Artwork not found" })

    const [claimed] = await db
      .select({ id: artworkPrints.id })
      .from(artworkPrints)
      .where(and(eq(artworkPrints.artworkId, artwork.id), inArray(artworkPrints.status, [...CLAIMED])))
      .limit(1)
    if (claimed) {
      return reply.code(409).send({
        error: "Conflict",
        message: "This edition has prints in a cart, reserved or sold — unpublish it instead of deleting it",
      })
    }

    // No foreign key reaches the polymorphic media table — the cleanup is ours.
    await deleteMediaForOwner("artwork", artwork.id)
    await db.delete(products).where(eq(products.id, artwork.productId))
    return reply.code(204).send()
  })
}

async function missingArtworkReference(artistId?: string | null, seriesId?: string | null): Promise<string | null> {
  if (artistId) {
    const [artist] = await db.select({ id: artists.id }).from(artists).where(eq(artists.id, artistId)).limit(1)
    if (!artist) return `Unknown artist: ${artistId}`
  }
  if (seriesId) {
    const [series] = await db
      .select({ id: artworkSeries.id })
      .from(artworkSeries)
      .where(eq(artworkSeries.id, seriesId))
      .limit(1)
    if (!series) return `Unknown series: ${seriesId}`
  }
  return null
}
