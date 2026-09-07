import { randomUUID } from "node:crypto"
import { MAX_ARTWORK_IMAGE_SIZE_BYTES } from "@armurier/shared"
import { eq } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import sharp from "sharp"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import { db } from "../db/client.js"
import { artworks, auditLogs } from "../db/schema.js"
import { env } from "../env.js"
import { storage } from "../storage/index.js"
import { renderProtectedImage } from "./watermark.js"

// Gun Art visuals (story 11.5). Two objects per artwork, sharing one id:
//   gun-art/originals/<uuid>   print-grade, PRIVATE — never served publicly
//   gun-art/public/<uuid>.webp downscaled + watermarked — the only file served
// Deriving one key from the other keeps this out of the schema, so the media
// model that story 7.5 will settle for the whole catalogue stays unprejudiced.
const PUBLIC_PREFIX = "gun-art/public"
const ORIGINAL_PREFIX = "gun-art/originals"
const ALLOWED_INPUT = new Set(["image/jpeg", "image/png", "image/webp", "image/tiff"])
const WEBP_QUALITY = 82
const FILENAME_RE = /^[0-9a-f-]{36}\.webp$/
const PUBLIC_URL_RE = /^\/api\/artworks\/images\/([0-9a-f-]{36})\.webp$/

/** Public URL stored on the artwork; the id in it addresses both objects. */
function publicUrlFor(id: string): string {
  return `/api/artworks/images/${id}.webp`
}

function idFromPublicUrl(url: string | null): string | null {
  return url ? (PUBLIC_URL_RE.exec(url)?.[1] ?? null) : null
}

function watermarkSettings() {
  return {
    text: env.ARTWORK_WATERMARK_TEXT,
    position: env.ARTWORK_WATERMARK_POSITION,
    opacity: env.ARTWORK_WATERMARK_OPACITY,
    scale: env.ARTWORK_WATERMARK_SCALE,
    maxWidth: env.ARTWORK_PUBLIC_MAX_WIDTH,
    quality: WEBP_QUALITY,
  }
}

/**
 * GET /api/artworks/images/:filename — the watermarked, downscaled file.
 *
 * The only Gun Art bytes that ever leave the bucket over a public route. Cached
 * immutably: the id changes whenever the visual does.
 *
 * ⚠️ `images` is therefore a reserved artwork slug — this static segment wins
 * over `/api/artworks/:slug` in the router.
 */
export const artworkImageRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/:filename", async (request, reply) => {
    const { filename } = request.params as { filename: string }
    if (!FILENAME_RE.test(filename)) {
      return reply.code(404).send({ error: "NotFound", message: "Image not found" })
    }

    let bytes: Buffer
    try {
      bytes = await storage.getBytes(`${PUBLIC_PREFIX}/${filename}`)
    } catch {
      return reply.code(404).send({ error: "NotFound", message: "Image not found" })
    }

    reply.header("content-type", "image/webp")
    reply.header("cache-control", "public, max-age=31536000, immutable")
    return reply.send(bytes)
  })
}

export const adminArtworkImageRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  /**
   * POST /api/admin/artworks/:slug/image — replace an artwork's visual.
   *
   * Stores the untouched original privately (that is what a print order needs)
   * and publishes only a capped, watermarked derivative. Replacing a visual
   * deletes the previous pair, so nothing is left dangling in the bucket.
   */
  fastify.post("/:slug/image", async (request, reply) => {
    const { slug } = request.params as { slug: string }
    const [artwork] = await db
      .select({ id: artworks.id, featuredImageUrl: artworks.featuredImageUrl })
      .from(artworks)
      .where(eq(artworks.slug, slug))
      .limit(1)
    if (!artwork) {
      return reply.code(404).send({ error: "NotFound", message: "Artwork not found" })
    }

    if (!request.isMultipart()) {
      return reply.code(400).send({ error: "BadRequest", message: "Expected a multipart/form-data request" })
    }

    let file: { buffer: Buffer; mimetype: string } | undefined
    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          if (part.fieldname !== "file") {
            part.file.resume()
            continue
          }
          const buffer = await part.toBuffer()
          // Print-grade files are large by nature — this is the widest cap in the
          // app, and it is what the plugin-level ceiling is sized on.
          if (part.file.truncated || buffer.length > MAX_ARTWORK_IMAGE_SIZE_BYTES) {
            return reply.code(413).send({ error: "PayloadTooLarge", message: "Image exceeds the maximum allowed size" })
          }
          file = { buffer, mimetype: part.mimetype }
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
      return reply
        .code(400)
        .send({ error: "UnsupportedMediaType", message: "Allowed image types: JPEG, PNG, WebP, TIFF" })
    }

    // The decode is the real content check — a mislabeled or polyglot file dies
    // here, whatever its declared Content-Type says.
    let rendered: Awaited<ReturnType<typeof renderProtectedImage>>
    let originalContentType: string
    try {
      const meta = await sharp(file.buffer).metadata()
      if (!meta.format || !["jpeg", "png", "webp", "tiff"].includes(meta.format)) {
        return reply.code(400).send({ error: "UnsupportedMediaType", message: "Unrecognised image content" })
      }
      originalContentType = `image/${meta.format}`
      rendered = await renderProtectedImage(file.buffer, watermarkSettings())
    } catch {
      return reply.code(400).send({ error: "UnsupportedMediaType", message: "Image could not be processed" })
    }

    const id = randomUUID()
    // Original first: if publishing then fails, we have kept the only copy of
    // the print-grade file rather than the disposable derivative.
    await storage.put({ key: `${ORIGINAL_PREFIX}/${id}`, body: file.buffer, contentType: originalContentType })
    await storage.put({ key: `${PUBLIC_PREFIX}/${id}.webp`, body: rendered.buffer, contentType: "image/webp" })

    await db
      .update(artworks)
      .set({ featuredImageUrl: publicUrlFor(id) })
      .where(eq(artworks.id, artwork.id))

    const previousId = idFromPublicUrl(artwork.featuredImageUrl)
    if (previousId && previousId !== id) {
      await storage.delete(`${PUBLIC_PREFIX}/${previousId}.webp`)
      await storage.delete(`${ORIGINAL_PREFIX}/${previousId}`)
    }

    await db.insert(auditLogs).values({
      userId: request.user.sub,
      userRole: request.user.role,
      entityType: "artwork",
      entityId: artwork.id,
      action: "artwork.image_replaced",
      newValue: {
        url: publicUrlFor(id),
        width: rendered.width,
        height: rendered.height,
        watermark: env.ARTWORK_WATERMARK_POSITION,
      },
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    })

    return reply.code(201).send({
      data: {
        url: publicUrlFor(id),
        width: rendered.width,
        height: rendered.height,
        watermark: {
          text: env.ARTWORK_WATERMARK_TEXT,
          position: env.ARTWORK_WATERMARK_POSITION,
          opacity: env.ARTWORK_WATERMARK_OPACITY,
          scale: env.ARTWORK_WATERMARK_SCALE,
        },
      },
    })
  })

  /**
   * GET /api/admin/artworks/:slug/image/original — the print-grade file.
   *
   * Admin-only, and the single way those bytes can be read: order processing
   * needs them, the storefront never does. Served as an attachment so a file
   * that ever slipped past the type checks cannot render in the browser.
   */
  fastify.get("/:slug/image/original", async (request, reply) => {
    const { slug } = request.params as { slug: string }
    const [artwork] = await db
      .select({ id: artworks.id, featuredImageUrl: artworks.featuredImageUrl })
      .from(artworks)
      .where(eq(artworks.slug, slug))
      .limit(1)

    const id = idFromPublicUrl(artwork?.featuredImageUrl ?? null)
    if (!artwork || !id) {
      return reply.code(404).send({ error: "NotFound", message: "No original on file for this artwork" })
    }

    let bytes: Buffer
    try {
      bytes = await storage.getBytes(`${ORIGINAL_PREFIX}/${id}`)
    } catch {
      return reply.code(404).send({ error: "NotFound", message: "No original on file for this artwork" })
    }

    // Sniffed from the bytes rather than remembered in a column: the format is
    // already in the file, and a second stored field could only drift from it.
    const format = (await sharp(bytes).metadata()).format

    await db.insert(auditLogs).values({
      userId: request.user.sub,
      userRole: request.user.role,
      entityType: "artwork",
      entityId: artwork.id,
      action: "artwork.original_downloaded",
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    })

    reply.header("content-type", format ? `image/${format}` : "application/octet-stream")
    reply.header("content-disposition", `attachment; filename="${slug}-original.${format ?? "bin"}"`)
    reply.header("cache-control", "private, no-store")
    return reply.send(bytes)
  })
}
