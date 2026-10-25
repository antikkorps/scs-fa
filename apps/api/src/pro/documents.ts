// Story 12.8d — the documents an organisation files on its own account
// (gunsmith licence, prefectoral authorisation, purchase order…), reviewed by
// SCS in the same queue as a person's and judged on the quotes with category
// A, B or C items. The member files, follows and withdraws them here.

import { organisationDocumentMetaSchema, uuidParamSchema } from "@armurier/shared"
import { and, desc, eq, ne } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { db } from "../db/client.js"
import { legalDocuments } from "../db/schema.js"
import { validationError } from "../http.js"
import { OWNER_DOC_FIELDS, receiveDocument, scanInBackground } from "../legal-documents/upload.js"
import { storage } from "../storage/index.js"
import { proOrganisationOf } from "./access.js"

const NOT_FOUND = { error: "NotFound", message: "Document not found" }

export const organisationDocumentRoutes: FastifyPluginAsync = async (fastify) => {
  /** POST / — a professional document, filed on the organisation. */
  fastify.post("/", async (request, reply) => {
    const created = await receiveDocument(request, reply, {
      owner: { organisationId: proOrganisationOf(request).id },
      metaSchema: organisationDocumentMetaSchema,
      log: fastify.log,
    })
    if (!created) return reply
    scanInBackground(created.id, fastify.log)
    return reply.code(201).send({ data: created })
  })

  fastify.get("/", async (request, reply) => {
    const rows = await db
      .select(OWNER_DOC_FIELDS)
      .from(legalDocuments)
      .where(eq(legalDocuments.organisationId, proOrganisationOf(request).id))
      .orderBy(desc(legalDocuments.uploadedAt))
    return reply.send({ data: rows })
  })

  /** GET /:id — the document and a short-lived download link, once it passed antivirus. */
  fastify.get("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const [row] = await db
      .select({ ...OWNER_DOC_FIELDS, s3Key: legalDocuments.s3Key })
      .from(legalDocuments)
      .where(
        and(eq(legalDocuments.id, params.data.id), eq(legalDocuments.organisationId, proOrganisationOf(request).id)),
      )
      .limit(1)
    if (!row) return reply.code(404).send(NOT_FOUND)
    const { s3Key, ...doc } = row
    const downloadUrl = doc.scanStatus === "clean" ? await storage.getUrl(s3Key) : null
    return reply.send({ data: { ...doc, downloadUrl } })
  })

  /** DELETE /:id — an approved document is the proof behind accepted quotes: SCS keeps it. */
  fastify.delete("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const owned = and(
      eq(legalDocuments.id, params.data.id),
      eq(legalDocuments.organisationId, proOrganisationOf(request).id),
    )
    const [deleted] = await db
      .delete(legalDocuments)
      .where(and(owned, ne(legalDocuments.verificationStatus, "approved")))
      .returning({ s3Key: legalDocuments.s3Key })
    if (!deleted) {
      const [approved] = await db.select({ id: legalDocuments.id }).from(legalDocuments).where(owned)
      if (approved) {
        return reply
          .code(409)
          .send({ error: "DocumentApproved", message: "An approved document is kept as proof of the purchases" })
      }
      return reply.code(404).send(NOT_FOUND)
    }
    await storage.delete(deleted.s3Key).catch((err) => fastify.log.error({ err }, "storage delete failed"))
    return reply.code(204).send()
  })
}
