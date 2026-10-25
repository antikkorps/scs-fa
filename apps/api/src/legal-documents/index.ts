import { legalDocumentMetaSchema, uuidParamSchema } from "@armurier/shared"
import { and, desc, eq, ne } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { authenticate } from "../auth/authenticate.js"
import { db } from "../db/client.js"
import { legalDocuments } from "../db/schema.js"
import { validationError } from "../http.js"
import { recomputeOrderLegalStatus } from "../orders/legal-status.js"
import { storage } from "../storage/index.js"
import { OWNER_DOC_FIELDS as DOC_FIELDS, receiveDocument, scanInBackground } from "./upload.js"

export const legalDocumentRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)

  // POST /api/legal-documents — multipart upload of a legal document
  fastify.post("/", async (request, reply) => {
    const userId = request.user.sub
    const created = await receiveDocument(request, reply, {
      owner: { userId },
      metaSchema: legalDocumentMetaSchema,
      log: fastify.log,
    })
    if (!created) return reply

    // A new document may move the user's orders forward (e.g. after a rejection)
    await recomputeOrderLegalStatus(userId)
    scanInBackground(created.id, fastify.log)
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
    // Only ever serve bytes that passed antivirus. A pending/infected document
    // yields no URL so neither the owner nor a reviewer can fetch unsafe content.
    const downloadUrl = doc.scanStatus === "clean" ? await storage.getUrl(s3Key) : null
    return reply.code(200).send({ data: { ...doc, downloadUrl } })
  })

  // DELETE /api/legal-documents/:id — remove a document (storage + row)
  fastify.delete("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(validationError(params.error.issues))
    }

    const owned = and(eq(legalDocuments.id, params.data.id), eq(legalDocuments.userId, request.user.sub))
    // An approved document is the proof behind a cleared purchase: SCS must keep
    // it, so only a pending, rejected or expired one may go (story 12.9f).
    const [deleted] = await db
      .delete(legalDocuments)
      .where(and(owned, ne(legalDocuments.verificationStatus, "approved")))
      .returning({ id: legalDocuments.id, s3Key: legalDocuments.s3Key })
    if (!deleted) {
      const [approved] = await db.select({ id: legalDocuments.id }).from(legalDocuments).where(owned)
      if (approved) {
        return reply
          .code(409)
          .send({ error: "DocumentApproved", message: "An approved document is kept as proof of the purchase" })
      }
      return reply.code(404).send({ error: "NotFound", message: "Document not found" })
    }

    await storage.delete(deleted.s3Key).catch((err) => fastify.log.error({ err }, "storage delete failed"))
    // Removing a document can regress orders still under review
    await recomputeOrderLegalStatus(request.user.sub)
    return reply.code(204).send()
  })
}
