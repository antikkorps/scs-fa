import { randomUUID } from "node:crypto"
import {
  ALLOWED_LEGAL_DOC_MIME_TYPES,
  type AllowedLegalDocMimeType,
  LEGAL_DOC_REVIEW_SLA_HOURS,
  legalDocumentMetaSchema,
  uuidParamSchema,
} from "@armurier/shared"
import { and, desc, eq } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { authenticate } from "../auth/authenticate.js"
import { db } from "../db/client.js"
import { legalDocuments } from "../db/schema.js"
import { validationError } from "../http.js"
import { recomputeOrderLegalStatus } from "../orders/legal-status.js"
import { storage } from "../storage/index.js"
import { scanDocument } from "./scan.js"

// Fields returned to the client — never the raw storage URL (read access is
// granted on demand through a short-lived presigned URL on GET /:id).
const DOC_FIELDS = {
  id: legalDocuments.id,
  docType: legalDocuments.docType,
  docNumber: legalDocuments.docNumber,
  mimeType: legalDocuments.mimeType,
  fileSize: legalDocuments.fileSize,
  scanStatus: legalDocuments.scanStatus,
  scannedAt: legalDocuments.scannedAt,
  verificationStatus: legalDocuments.verificationStatus,
  issuedAt: legalDocuments.issuedAt,
  expiresAt: legalDocuments.expiresAt,
  uploadedAt: legalDocuments.uploadedAt,
} as const

const MIME_EXTENSION: Record<AllowedLegalDocMimeType, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
}

function isAllowedMime(mime: string): mime is AllowedLegalDocMimeType {
  return (ALLOWED_LEGAL_DOC_MIME_TYPES as readonly string[]).includes(mime)
}

export const legalDocumentRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)

  // POST /api/legal-documents — multipart upload of a legal document
  fastify.post("/", async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.code(400).send({ error: "BadRequest", message: "Expected a multipart/form-data request" })
    }

    const fields: Record<string, string> = {}
    let file: { buffer: Buffer; mimetype: string } | undefined

    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          if (part.fieldname !== "file") {
            part.file.resume() // drain ignored file streams
            continue
          }
          const buffer = await part.toBuffer()
          // Enforced by @fastify/multipart limits; flagged here when exceeded.
          if (part.file.truncated) {
            return reply.code(413).send({ error: "PayloadTooLarge", message: "File exceeds the maximum allowed size" })
          }
          file = { buffer, mimetype: part.mimetype }
        } else {
          fields[part.fieldname] = String(part.value)
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("maximum file size")) {
        return reply.code(413).send({ error: "PayloadTooLarge", message: "File exceeds the maximum allowed size" })
      }
      throw err
    }

    if (!file) {
      return reply.code(400).send({ error: "BadRequest", message: 'A file part named "file" is required' })
    }
    if (!isAllowedMime(file.mimetype)) {
      return reply.code(400).send({
        error: "UnsupportedMediaType",
        message: `Unsupported file type. Allowed: ${ALLOWED_LEGAL_DOC_MIME_TYPES.join(", ")}`,
      })
    }

    const meta = legalDocumentMetaSchema.safeParse(fields)
    if (!meta.success) {
      return reply.code(400).send(validationError(meta.error.issues))
    }

    const userId = request.user.sub
    const id = randomUUID()
    const key = `legal-documents/${userId}/${id}.${MIME_EXTENSION[file.mimetype]}`

    const stored = await storage.put({ key, body: file.buffer, contentType: file.mimetype })

    const created = await db
      .insert(legalDocuments)
      .values({
        id,
        userId,
        docType: meta.data.docType,
        docNumber: meta.data.docNumber,
        s3Key: stored.key,
        s3Url: stored.url,
        mimeType: file.mimetype,
        fileSize: file.buffer.length,
        issuedAt: meta.data.issuedAt,
        expiresAt: meta.data.expiresAt,
        scanStatus: "pending",
        verificationStatus: "pending",
        // Admin review SLA clock starts at upload
        verificationDeadline: new Date(Date.now() + LEGAL_DOC_REVIEW_SLA_HOURS * 60 * 60 * 1000),
      })
      .returning(DOC_FIELDS)
      .then(([row]) => row)
      .catch(async (err) => {
        // Compensate: don't leave an orphaned object if the row insert fails.
        await storage.delete(key).catch(() => {})
        throw err
      })

    // A new document may move the user's orders forward (e.g. after a rejection)
    await recomputeOrderLegalStatus(userId)

    // Antivirus scan runs out of band; the response reports scanStatus "pending".
    void scanDocument(id).catch((err) => fastify.log.error({ err, id }, "legal document scan failed"))

    return reply.code(201).send({ data: created })
  })

  // GET /api/legal-documents — the user's uploaded documents (newest first)
  fastify.get("/", async (request, reply) => {
    const rows = await db
      .select(DOC_FIELDS)
      .from(legalDocuments)
      .where(eq(legalDocuments.userId, request.user.sub))
      .orderBy(desc(legalDocuments.uploadedAt))
    return reply.code(200).send({ data: rows })
  })

  // GET /api/legal-documents/:id — document detail + a short-lived download URL
  fastify.get("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(validationError(params.error.issues))
    }

    const [row] = await db
      .select({ ...DOC_FIELDS, s3Key: legalDocuments.s3Key })
      .from(legalDocuments)
      .where(and(eq(legalDocuments.id, params.data.id), eq(legalDocuments.userId, request.user.sub)))
      .limit(1)
    if (!row) {
      return reply.code(404).send({ error: "NotFound", message: "Document not found" })
    }

    const { s3Key, ...doc } = row
    const downloadUrl = await storage.getUrl(s3Key)
    return reply.code(200).send({ data: { ...doc, downloadUrl } })
  })

  // DELETE /api/legal-documents/:id — remove a document (storage + row)
  fastify.delete("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(validationError(params.error.issues))
    }

    const [deleted] = await db
      .delete(legalDocuments)
      .where(and(eq(legalDocuments.id, params.data.id), eq(legalDocuments.userId, request.user.sub)))
      .returning({ id: legalDocuments.id, s3Key: legalDocuments.s3Key })
    if (!deleted) {
      return reply.code(404).send({ error: "NotFound", message: "Document not found" })
    }

    await storage.delete(deleted.s3Key).catch((err) => fastify.log.error({ err }, "storage delete failed"))
    // Removing a document can regress orders still under review
    await recomputeOrderLegalStatus(request.user.sub)
    return reply.code(204).send()
  })
}
