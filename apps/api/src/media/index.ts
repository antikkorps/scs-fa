import {
  MAX_MEDIA_SIZE_BYTES,
  mediaOwnerQuerySchema,
  mediaUploadFieldsSchema,
  reorderMediaSchema,
  updateMediaSchema,
  uuidParamSchema,
} from "@armurier/shared"
import { and, asc, eq, sql } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import { db } from "../db/client.js"
import { media } from "../db/schema.js"
import { validationError } from "../http.js"
import { storage } from "../storage/index.js"
import {
  deleteRenditions,
  type MediaOwnerType,
  mediaUrl,
  newMediaId,
  originalKey,
  ownerExists,
  renderRenditions,
  syncOwnerFeaturedImage,
  UnusableImageError,
} from "./service.js"

const ALLOWED_INPUT = new Set(["image/jpeg", "image/png", "image/webp", "image/tiff"])
// `<uuid>/<width>.webp` and nothing else — no slashes or dots to traverse with.
const ID_RE = /^[0-9a-f-]{36}$/
const RENDITION_RE = /^(\d{2,5})\.webp$/

function toDto(row: typeof media.$inferSelect) {
  return {
    id: row.id,
    ownerType: row.ownerType,
    ownerId: row.ownerId,
    position: row.position,
    alt: row.alt,
    widths: row.widths,
    width: row.width,
    height: row.height,
    sizeBytes: row.sizeBytes,
    watermarked: row.watermarked,
    // The widest rendition, ready to drop into an <img src>.
    url: mediaUrl(row.id, (row.widths.at(-1) ?? row.width) as number),
    // `srcset`-ready: every width this particular file actually has.
    srcset: row.widths.map((w) => `${mediaUrl(row.id, w)} ${w}w`).join(", "),
  }
}

async function galleryOf(ownerType: MediaOwnerType, ownerId: string) {
  const rows = await db
    .select()
    .from(media)
    .where(and(eq(media.ownerType, ownerType), eq(media.ownerId, ownerId)))
    .orderBy(asc(media.position), asc(media.createdAt))
  return rows.map(toDto)
}

/** Admin gallery management for every catalogue visual (story 7.5b). */
export const adminMediaRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  /** GET /api/admin/media?ownerType=&ownerId= — one owner's gallery, in order. */
  fastify.get("/", async (request, reply) => {
    const parsed = mediaOwnerQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    return reply.send({ data: await galleryOf(parsed.data.ownerType, parsed.data.ownerId) })
  })

  /**
   * POST /api/admin/media — multipart upload; fields travel alongside the file.
   *
   * The new image goes to the END of the gallery, so an upload never silently
   * changes which visual is the main one.
   */
  fastify.post("/", async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.code(400).send({ error: "BadRequest", message: "Expected a multipart/form-data request" })
    }

    let file: { buffer: Buffer; mimetype: string } | undefined
    const fields: Record<string, string> = {}
    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          if (part.fieldname !== "file") {
            part.file.resume()
            continue
          }
          const buffer = await part.toBuffer()
          // ⚠️ Enforced here: `@fastify/multipart`'s per-request limits proved
          // inoperative (story 11.5), so the cap lives in the handler.
          if (part.file.truncated || buffer.length > MAX_MEDIA_SIZE_BYTES) {
            return reply.code(413).send({ error: "PayloadTooLarge", message: "Image exceeds the maximum allowed size" })
          }
          file = { buffer, mimetype: part.mimetype }
        } else {
          fields[part.fieldname] = String(part.value)
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("maximum file size")) {
        return reply.code(413).send({ error: "PayloadTooLarge", message: "Image exceeds the maximum allowed size" })
      }
      throw err
    }

    if (!file) {
      return reply.code(400).send({ error: "BadRequest", message: 'A file part named "file" is required' })
    }
    if (!ALLOWED_INPUT.has(file.mimetype)) {
      return reply.code(400).send({ error: "UnsupportedMediaType", message: "Allowed types: JPEG, PNG, WebP, TIFF" })
    }

    const parsed = mediaUploadFieldsSchema.safeParse(fields)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const { ownerType, ownerId, alt } = parsed.data

    // No foreign key can say this for us — the owner column is polymorphic.
    if (!(await ownerExists(ownerType, ownerId))) {
      return reply.code(404).send({ error: "NotFound", message: `No ${ownerType} with id ${ownerId}` })
    }

    const id = newMediaId()
    let rendered: Awaited<ReturnType<typeof renderRenditions>>
    try {
      rendered = await renderRenditions(id, file.buffer, ownerType)
    } catch (err) {
      if (err instanceof UnusableImageError) {
        return reply.code(400).send({ error: "UnsupportedMediaType", message: err.message })
      }
      return reply.code(400).send({ error: "UnsupportedMediaType", message: "Image could not be processed" })
    }

    const [{ next } = { next: 0 }] = await db
      .select({ next: sql<number>`coalesce(max(${media.position}) + 1, 0)::int` })
      .from(media)
      .where(and(eq(media.ownerType, ownerType), eq(media.ownerId, ownerId)))

    const [row] = await db
      .insert(media)
      .values({
        id,
        ownerType,
        ownerId,
        position: next,
        alt,
        widths: rendered.widths,
        width: rendered.width,
        height: rendered.height,
        sizeBytes: rendered.sizeBytes,
        watermarked: rendered.watermarked,
      })
      .returning()
    if (!row) throw new Error("Media insert returned no row")

    await syncOwnerFeaturedImage(ownerType, ownerId)
    return reply.code(201).send({ data: toDto(row) })
  })

  fastify.patch("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const parsed = updateMediaSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))

    const [row] = await db
      .update(media)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(media.id, params.data.id))
      .returning()
    if (!row) return reply.code(404).send({ error: "NotFound", message: "Media not found" })

    await syncOwnerFeaturedImage(row.ownerType, row.ownerId)
    return reply.send({ data: toDto(row) })
  })

  /**
   * PATCH /reorder — the whole gallery in one call.
   *
   * Reordering image by image would leave the gallery in a half-sorted state
   * between requests, and the main visual flickering with it.
   */
  fastify.patch("/reorder", async (request, reply) => {
    const parsed = reorderMediaSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const { ownerType, ownerId, ids } = parsed.data

    const existing = await db
      .select({ id: media.id })
      .from(media)
      .where(and(eq(media.ownerType, ownerType), eq(media.ownerId, ownerId)))
    const known = new Set(existing.map((r) => r.id))
    if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
      return reply
        .code(400)
        .send({ error: "ValidationError", message: "The id list must name every image of this gallery, exactly once" })
    }

    await db.transaction(async (tx) => {
      for (const [index, id] of ids.entries()) {
        await tx.update(media).set({ position: index, updatedAt: new Date() }).where(eq(media.id, id))
      }
      await syncOwnerFeaturedImage(ownerType, ownerId, tx)
    })

    return reply.send({ data: await galleryOf(ownerType, ownerId) })
  })

  fastify.delete("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))

    const [row] = await db.select().from(media).where(eq(media.id, params.data.id)).limit(1)
    if (!row) return reply.code(404).send({ error: "NotFound", message: "Media not found" })

    await deleteRenditions(row.id, row.widths, row.watermarked)
    await db.delete(media).where(eq(media.id, row.id))

    // Close the gap so positions stay 0..n-1 — the main visual is "position 0",
    // which only means anything if the sequence has no holes.
    const rest = await db
      .select({ id: media.id })
      .from(media)
      .where(and(eq(media.ownerType, row.ownerType), eq(media.ownerId, row.ownerId)))
      .orderBy(asc(media.position), asc(media.createdAt))
    for (const [index, r] of rest.entries()) {
      await db.update(media).set({ position: index }).where(eq(media.id, r.id))
    }

    await syncOwnerFeaturedImage(row.ownerType, row.ownerId)
    return reply.code(204).send()
  })

  /**
   * GET /:id/original — admin only, the untouched print-grade file.
   *
   * Only ever exists for a protected (Gun Art) visual, and these bytes travel
   * over no other route.
   */
  fastify.get("/:id/original", async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!ID_RE.test(id)) return reply.code(404).send({ error: "NotFound", message: "Media not found" })

    const [row] = await db.select().from(media).where(eq(media.id, id)).limit(1)
    if (!row?.watermarked) {
      return reply.code(404).send({ error: "NotFound", message: "No original stored for this media" })
    }

    let bytes: Buffer
    try {
      bytes = await storage.getBytes(originalKey(id))
    } catch {
      return reply.code(404).send({ error: "NotFound", message: "No original stored for this media" })
    }

    reply.header("content-type", "application/octet-stream")
    reply.header("cache-control", "no-store")
    reply.header("content-disposition", `attachment; filename="${id}"`)
    return reply.send(bytes)
  })
}

/**
 * GET /api/media/:id/:rendition — the only catalogue image bytes served publicly.
 *
 * Cached immutably: a new visual gets a new id, so a URL never changes meaning.
 */
export const mediaRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/:id/:rendition", async (request, reply) => {
    const { id, rendition } = request.params as { id: string; rendition: string }
    if (!ID_RE.test(id) || !RENDITION_RE.test(rendition)) {
      return reply.code(404).send({ error: "NotFound", message: "Image not found" })
    }

    let bytes: Buffer
    try {
      bytes = await storage.getBytes(`media/${id}/${rendition}`)
    } catch {
      return reply.code(404).send({ error: "NotFound", message: "Image not found" })
    }

    reply.header("content-type", "image/webp")
    reply.header("cache-control", "public, max-age=31536000, immutable")
    return reply.send(bytes)
  })
}
