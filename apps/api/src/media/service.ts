import { randomUUID } from "node:crypto"
import { MEDIA_FORMATS, MEDIA_WIDTHS, type MediaFormat, mediaRenditionUrl } from "@armurier/shared"
import { and, asc, eq } from "drizzle-orm"
import sharp, { type Sharp } from "sharp"
import { protectedPipeline } from "../artworks/watermark.js"
import { db } from "../db/client.js"
import { artists, artworkSeries, artworks, media, products } from "../db/schema.js"
import { env } from "../env.js"
import { storage } from "../storage/index.js"
import { ObjectNotFoundError } from "../storage/types.js"

export const MEDIA_OWNER_TYPES = ["product", "artwork", "artwork_series", "artist"] as const
export type MediaOwnerType = (typeof MEDIA_OWNER_TYPES)[number]

type DbExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db

const KEY_PREFIX = "media"
const ORIGINAL_PREFIX = "media/originals"
const WEBP_QUALITY = 82
/**
 * AVIF at 50 weighs 66–72 % of WebP at 82 on photographs, at a visually
 * equivalent quality (measured 2026-09-24). Effort 3 keeps a 1400px encode
 * under half a second — paid once, at upload, by the admin.
 */
const AVIF_QUALITY = 50
const AVIF_EFFORT = 3

/**
 * The widths are pre-generated at upload (MEDIA_WIDTHS, shared with the front),
 * in both formats — generated here rather than resized at the edge, because the
 * project's storage has to stay provider-agnostic: the same files work locally,
 * on Scaleway and behind any CDN.
 */
export { MEDIA_WIDTHS }

/** Public URL of one WebP rendition — the one stored on the owner row. */
export function mediaUrl(id: string, width: number): string {
  return mediaRenditionUrl(id, width, "webp")
}

function encode(image: Sharp, format: MediaFormat): Promise<Buffer> {
  return format === "avif"
    ? image.avif({ quality: AVIF_QUALITY, effort: AVIF_EFFORT }).toBuffer()
    : image.webp({ quality: WEBP_QUALITY }).toBuffer()
}

/** Storage key of one rendition. */
export function renditionKey(id: string, width: number, format: MediaFormat): string {
  return `${KEY_PREFIX}/${id}/${width}.${format}`
}

/**
 * ⚠️ Gun Art visuals keep story 11.5's protection **inside this pipeline**.
 *
 * A gallery that served artwork images plainly would be a hole straight through
 * that story: the mark burnt into the pixels is the only measure surviving a
 * screenshot. So an `artwork` upload is watermarked and capped like the 11.5
 * route, and the untouched original is stored privately — that is what a print
 * order needs, and it never leaves over a public route.
 */
function isProtected(ownerType: MediaOwnerType): boolean {
  return ownerType === "artwork"
}

export interface RenditionSet {
  widths: number[]
  /** Intrinsic size of the largest rendition. */
  width: number
  height: number
  sizeBytes: number
  watermarked: boolean
}

/** Decode, validate, strip metadata and render every width. Throws on unusable bytes. */
export async function renderRenditions(id: string, input: Buffer, ownerType: MediaOwnerType): Promise<RenditionSet> {
  // sharp's decode is the real content check — far stronger than a declared
  // Content-Type, and it rejects mislabeled or polyglot files.
  const probe = sharp(input)
  const meta = await probe.metadata()
  if (!meta.format || !["jpeg", "png", "webp", "tiff"].includes(meta.format)) {
    throw new UnusableImageError("Unrecognised image content")
  }

  const watermarked = isProtected(ownerType)
  if (watermarked) {
    // The print-grade file is what an order prints; it stays private.
    await storage.put({ key: `${ORIGINAL_PREFIX}/${id}`, body: input, contentType: "application/octet-stream" })
  }

  // `.rotate()` honours EXIF orientation BEFORE the metadata is dropped;
  // re-encoding to WebP is what actually strips it (EXIF GPS is a data leak).
  const upright = await sharp(input).rotate().toBuffer()
  const uprightMeta = await sharp(upright).metadata()
  const sourceWidth = uprightMeta.width ?? 0
  const sourceHeight = uprightMeta.height ?? 0
  if (sourceWidth === 0 || sourceHeight === 0) {
    throw new UnusableImageError("Image has no dimensions")
  }

  // A protected visual is additionally capped: the HD file must not be
  // reachable by asking for a wide rendition.
  const ceiling = watermarked ? Math.min(env.ARTWORK_PUBLIC_MAX_WIDTH, sourceWidth) : sourceWidth
  // Never upscale, and always keep at least one rendition even for a tiny image.
  const widths: number[] = MEDIA_WIDTHS.filter((w) => w <= ceiling)
  if (widths.length === 0) widths.push(ceiling)

  let sizeBytes = 0
  let largestHeight = sourceHeight
  for (const width of widths) {
    // One set of pixels per width — watermarked for a protected visual — then
    // each format encoded from it.
    let image: Sharp
    let height: number
    if (watermarked) {
      const rendered = await protectedPipeline(upright, {
        text: env.ARTWORK_WATERMARK_TEXT,
        position: env.ARTWORK_WATERMARK_POSITION,
        opacity: env.ARTWORK_WATERMARK_OPACITY,
        scale: env.ARTWORK_WATERMARK_SCALE,
        maxWidth: width,
      })
      image = rendered.image
      height = rendered.height
    } else {
      const resized = await sharp(upright)
        .resize({ width, withoutEnlargement: true })
        .toBuffer({ resolveWithObject: true })
      image = sharp(resized.data)
      height = resized.info.height
    }
    if (width === widths[widths.length - 1]) largestHeight = height

    for (const format of MEDIA_FORMATS) {
      const buffer = await encode(image.clone(), format)
      sizeBytes += buffer.length
      await storage.put({ key: renditionKey(id, width, format), body: buffer, contentType: `image/${format}` })
    }
  }

  const largest = widths[widths.length - 1] as number
  return { widths, width: largest, height: largestHeight, sizeBytes, watermarked }
}

export class UnusableImageError extends Error {}

/** Remove every stored rendition of one media row (and its private original). */
export async function deleteRenditions(id: string, widths: number[], watermarked: boolean) {
  for (const width of widths) {
    for (const format of MEDIA_FORMATS) {
      await storage.delete(renditionKey(id, width, format)).catch(() => {})
    }
  }
  if (watermarked) await storage.delete(`${ORIGINAL_PREFIX}/${id}`).catch(() => {})
}

export function originalKey(id: string): string {
  return `${ORIGINAL_PREFIX}/${id}`
}

export function newMediaId(): string {
  return randomUUID()
}

/**
 * Push the position-0 image onto the owner's own "main visual" column.
 *
 * The column stays because the whole storefront reads it — cards, OG images,
 * sitemap, llms.txt — but it is now **written by the server**, never typed in:
 * one source of truth for "which image is the main one".
 */
export async function syncOwnerFeaturedImage(ownerType: MediaOwnerType, ownerId: string, tx: DbExecutor = db) {
  const [first] = await tx
    .select({ id: media.id, widths: media.widths })
    .from(media)
    .where(and(eq(media.ownerType, ownerType), eq(media.ownerId, ownerId)))
    .orderBy(asc(media.position), asc(media.createdAt))
    .limit(1)

  // The widest rendition: cards and OG images want the best available.
  const url = first ? mediaUrl(first.id, (first.widths.at(-1) ?? MEDIA_WIDTHS[0]) as number) : null

  switch (ownerType) {
    case "product":
      await tx.update(products).set({ featuredImageUrl: url, updatedAt: new Date() }).where(eq(products.id, ownerId))
      break
    case "artwork":
      await tx.update(artworks).set({ featuredImageUrl: url, updatedAt: new Date() }).where(eq(artworks.id, ownerId))
      break
    case "artwork_series":
      await tx
        .update(artworkSeries)
        .set({ coverImageUrl: url, updatedAt: new Date() })
        .where(eq(artworkSeries.id, ownerId))
      break
    case "artist":
      await tx.update(artists).set({ portraitUrl: url, updatedAt: new Date() }).where(eq(artists.id, ownerId))
      break
  }
}

/**
 * ⚠️ The price of the polymorphic table: no foreign key removes these rows when
 * the owner goes. Deleting an owner therefore has to call this, and a test locks
 * it down — otherwise every deleted product would leave its files in the bucket
 * and its rows in the table, forever.
 */
export async function deleteMediaForOwner(ownerType: MediaOwnerType, ownerId: string) {
  const rows = await db
    .select({ id: media.id, widths: media.widths, watermarked: media.watermarked })
    .from(media)
    .where(and(eq(media.ownerType, ownerType), eq(media.ownerId, ownerId)))

  for (const row of rows) {
    await deleteRenditions(row.id, row.widths, row.watermarked)
  }
  if (rows.length > 0) {
    await db.delete(media).where(and(eq(media.ownerType, ownerType), eq(media.ownerId, ownerId)))
  }
}

/** Does the owner row actually exist? The polymorphic column cannot say. */
export async function ownerExists(ownerType: MediaOwnerType, ownerId: string): Promise<boolean> {
  const table = { product: products, artwork: artworks, artwork_series: artworkSeries, artist: artists }[ownerType]
  const [row] = await db.select({ id: table.id }).from(table).where(eq(table.id, ownerId)).limit(1)
  return Boolean(row)
}

/**
 * Give every existing media row its AVIF renditions (story 9.6) — the uploads
 * made before AVIF was generated. Idempotent: a width whose AVIF is already
 * stored is left alone, so the command can be re-run after an interruption.
 *
 * Encoded from the WebP of the same width: an ordinary product keeps no
 * original, and a protected visual's AVIF must carry the watermark the WebP
 * already has. A second lossy generation, at a quality where it does not show.
 */
export async function backfillAvifRenditions(): Promise<{ created: number; skipped: number; failed: number }> {
  const rows = await db.select({ id: media.id, widths: media.widths }).from(media)
  const tally = { created: 0, skipped: 0, failed: 0 }

  for (const row of rows) {
    for (const width of row.widths) {
      const avifKey = renditionKey(row.id, width, "avif")
      try {
        await storage.getBytes(avifKey)
        tally.skipped++
        continue
      } catch (error) {
        if (!(error instanceof ObjectNotFoundError)) throw error
      }
      try {
        const webp = await storage.getBytes(renditionKey(row.id, width, "webp"))
        const buffer = await encode(sharp(webp), "avif")
        await storage.put({ key: avifKey, body: buffer, contentType: "image/avif" })
        tally.created++
      } catch {
        // A row whose WebP is itself missing cannot be helped here: reported, not fatal.
        tally.failed++
      }
    }
  }
  return tally
}
