import { randomUUID } from "node:crypto"
import type { FastifyPluginAsync } from "fastify"
import sharp from "sharp"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import { storage } from "../storage/index.js"

// Blog article images. Uploaded by admins, re-encoded to WebP, and served as
// durable public assets (the editor embeds them in article HTML).
const ALLOWED_INPUT = new Set(["image/jpeg", "image/png", "image/webp"])
const MAX_WIDTH = 1600 // downscale only — large originals shrink, small ones are untouched
const WEBP_QUALITY = 80
const KEY_PREFIX = "blog-images"
// Stored filenames are `<uuid>.webp`; the serve route only accepts that shape
// (no slashes/dots traversal).
const FILENAME_RE = /^[0-9a-f-]{36}\.webp$/

/** POST /api/admin/blog/images — admin uploads an image; we convert it to WebP. */
export const adminBlogImageRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  fastify.post("/", async (request, reply) => {
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
          if (part.file.truncated) {
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
      return reply.code(400).send({ error: "UnsupportedMediaType", message: "Allowed image types: JPEG, PNG, WebP" })
    }

    // sharp decodes + validates the bytes (rejecting mislabeled/polyglot files),
    // then we re-encode to WebP. The decode is the real content check — far
    // stronger than trusting the declared Content-Type.
    let webp: Buffer
    try {
      const pipeline = sharp(file.buffer)
      const meta = await pipeline.metadata()
      if (!meta.format || !["jpeg", "png", "webp"].includes(meta.format)) {
        return reply.code(400).send({ error: "UnsupportedMediaType", message: "Unrecognised image content" })
      }
      webp = await pipeline
        .rotate() // honour EXIF orientation before stripping metadata
        .resize({ width: MAX_WIDTH, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer()
    } catch {
      return reply.code(400).send({ error: "UnsupportedMediaType", message: "Image could not be processed" })
    }

    const filename = `${randomUUID()}.webp`
    await storage.put({ key: `${KEY_PREFIX}/${filename}`, body: webp, contentType: "image/webp" })

    // Relative URL: single-origin in prod (Caddy), dev-proxied in development —
    // so no host is baked into stored article HTML.
    return reply.code(201).send({ data: { url: `/api/blog/images/${filename}` } })
  })
}

/** GET /api/blog/images/:filename — public, durable image bytes. */
export const blogImageRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/:filename", async (request, reply) => {
    const { filename } = request.params as { filename: string }
    if (!FILENAME_RE.test(filename)) {
      return reply.code(404).send({ error: "NotFound", message: "Image not found" })
    }

    let bytes: Buffer
    try {
      bytes = await storage.getBytes(`${KEY_PREFIX}/${filename}`)
    } catch {
      return reply.code(404).send({ error: "NotFound", message: "Image not found" })
    }

    reply.header("content-type", "image/webp")
    reply.header("cache-control", "public, max-age=31536000, immutable")
    return reply.send(bytes)
  })
}
