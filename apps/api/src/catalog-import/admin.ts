import { createHash } from "node:crypto"
import { MAX_CATALOG_IMPORT_FILE_BYTES, uuidParamSchema } from "@armurier/shared"
import { readSpreadsheet, SpreadsheetError } from "@armurier/shared/spreadsheet"
import { and, desc, eq } from "drizzle-orm"
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import { db } from "../db/client.js"
import { catalogImportImages, catalogImports, products } from "../db/schema.js"
import { env } from "../env.js"
import { drainCatalogImages, imageQueueStats } from "./images.js"
import { commitCatalogImport, ImportFileError, type ImportPlan, planCatalogImport } from "./service.js"

interface Upload {
  bytes: Buffer
  fileName: string
  fields: Record<string, string>
}

const tooLarge = (reply: FastifyReply) =>
  reply.code(413).send({ error: "PayloadTooLarge", message: "File exceeds the maximum allowed size" })

/** Read the multipart body: one `file` part plus plain fields. Replies and returns null on a bad request. */
async function readUpload(request: FastifyRequest, reply: FastifyReply): Promise<Upload | null> {
  if (!request.isMultipart()) {
    await reply.code(400).send({ error: "BadRequest", message: "Expected a multipart/form-data request" })
    return null
  }
  let file: { bytes: Buffer; fileName: string } | undefined
  const fields: Record<string, string> = {}
  try {
    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (part.fieldname !== "file") {
          part.file.resume()
          continue
        }
        const bytes = await part.toBuffer()
        // Enforced here: the plugin-level limit is a backstop for every route.
        if (part.file.truncated || bytes.length > MAX_CATALOG_IMPORT_FILE_BYTES) {
          await tooLarge(reply)
          return null
        }
        file = { bytes, fileName: part.filename || "import" }
      } else {
        fields[part.fieldname] = String(part.value)
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("maximum file size")) {
      await tooLarge(reply)
      return null
    }
    throw err
  }
  if (!file) {
    await reply.code(400).send({ error: "BadRequest", message: 'A file part named "file" is required' })
    return null
  }
  return { ...file, fields }
}

/** Parse + plan, turning file-level problems into a 400. */
async function planFromUpload(upload: Upload, overwrite: boolean, reply: FastifyReply): Promise<ImportPlan | null> {
  try {
    return await planCatalogImport(await readSpreadsheet(upload.bytes), overwrite)
  } catch (err) {
    if (err instanceof SpreadsheetError || err instanceof ImportFileError) {
      await reply.code(400).send({ error: "BadRequest", message: err.message })
      return null
    }
    throw err
  }
}

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")
const isTrue = (v: string | undefined) => v === "true" || v === "1" || v === "on"

/** Public shape of a plan row — internal resolution details stay server-side. */
function reportRow(row: ImportPlan["rows"][number]) {
  return {
    line: row.line,
    action: row.action,
    errors: row.errors,
    warnings: row.warnings,
    supplier: row.supplier,
    supplierSku: row.supplierSku,
    name: row.name,
    sku: row.sku,
    images: row.images,
  }
}

/** Admin: bulk import of supplier catalogues (story 12.2). */
export const adminCatalogImportRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  /**
   * POST /preview — dry run. Nothing is written; the response lists what each
   * row WOULD do, plus the file hash the commit must echo back.
   */
  fastify.post("/preview", async (request, reply) => {
    const upload = await readUpload(request, reply)
    if (!upload) return reply
    const overwrite = isTrue(upload.fields.overwrite)
    const plan = await planFromUpload(upload, overwrite, reply)
    if (!plan) return reply
    return reply.send({
      data: {
        fileName: upload.fileName,
        fileSha256: sha256(upload.bytes),
        overwrite,
        summary: plan.summary,
        suppliersToCreate: plan.suppliersToCreate,
        // Skipped rows are the human's own "non": listing them would only bury the rest.
        rows: plan.rows.filter((r) => r.action !== "skipped").map(reportRow),
      },
    })
  })

  /**
   * POST / — commit. The file is sent again with the hash the preview returned:
   * a different file (or an edited one) is refused, so what lands is exactly
   * what was reviewed.
   */
  fastify.post("/", async (request, reply) => {
    const upload = await readUpload(request, reply)
    if (!upload) return reply
    const fileSha256 = sha256(upload.bytes)
    if (upload.fields.expectedSha256 !== fileSha256) {
      return reply.code(409).send({
        error: "Conflict",
        message: "This file is not the one that was previewed — preview it again before importing",
      })
    }
    const overwrite = isTrue(upload.fields.overwrite)
    const plan = await planFromUpload(upload, overwrite, reply)
    if (!plan) return reply
    if (plan.summary.create + plan.summary.update === 0) {
      return reply.code(400).send({ error: "BadRequest", message: "Nothing to import" })
    }

    const result = await commitCatalogImport(plan, {
      fileName: upload.fileName,
      fileSha256,
      overwrite,
      userId: request.user.sub,
    })
    request.log.info({ ...result }, "catalogue import committed")
    // Images download after the response. Tests drive the worker themselves.
    if (result.imagesQueued > 0 && env.NODE_ENV !== "test") void drainCatalogImages(request.log)
    return reply.code(201).send({ data: result })
  })

  /** GET / — import history, most recent first, with each import's image queue. */
  fastify.get("/", async (_request, reply) => {
    const rows = await db.select().from(catalogImports).orderBy(desc(catalogImports.createdAt)).limit(50)
    const stats = await imageQueueStats(rows.map((r) => r.id))
    const data = rows.map((r) => ({ ...r, images: stats.get(r.id) ?? { pending: 0, done: 0, failed: 0 } }))
    return reply.send({ data })
  })

  /** GET /:id/failed-images — what could not be fetched, and why. */
  fastify.get("/:id/failed-images", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ error: "ValidationError", message: "Invalid id" })
    const rows = await db
      .select({
        id: catalogImportImages.id,
        url: catalogImportImages.url,
        error: catalogImportImages.error,
        attempts: catalogImportImages.attempts,
        productId: products.id,
        productName: products.name,
        productSku: products.sku,
      })
      .from(catalogImportImages)
      .innerJoin(products, eq(products.id, catalogImportImages.productId))
      .where(and(eq(catalogImportImages.importId, params.data.id), eq(catalogImportImages.status, "failed")))
      .orderBy(products.name, catalogImportImages.position)
      .limit(1000)
    return reply.send({ data: rows })
  })

  /** POST /:id/retry-images — put an import's failed images back in the queue. */
  fastify.post("/:id/retry-images", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ error: "ValidationError", message: "Invalid id" })
    const requeued = await db
      .update(catalogImportImages)
      .set({ status: "pending", attempts: 0, error: null, updatedAt: new Date() })
      .where(and(eq(catalogImportImages.importId, params.data.id), eq(catalogImportImages.status, "failed")))
      .returning({ id: catalogImportImages.id })
    if (requeued.length > 0 && env.NODE_ENV !== "test") void drainCatalogImages(request.log)
    return reply.send({ data: { requeued: requeued.length } })
  })
}
