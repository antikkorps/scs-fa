import {
  type LegalDocRejectionReason,
  type LegalDocType,
  legalDocQueueQuerySchema,
  rejectLegalDocumentSchema,
  uuidParamSchema,
} from "@armurier/shared"
import { and, asc, count, eq, sql } from "drizzle-orm"
import type { FastifyPluginAsync, FastifyRequest } from "fastify"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import { db } from "../db/client.js"
import { auditLogs, legalDocuments, users } from "../db/schema.js"
import { sendLegalDocApprovedEmail, sendLegalDocRejectedEmail } from "../email.js"
import { validationError } from "../http.js"
import { recomputeOrderLegalStatus } from "../orders/legal-status.js"
import { storage } from "../storage/index.js"

// Reviewer-facing fields — raw storage URL stays internal, reads go through
// a short-lived presigned URL on the detail route.
const DOC_FIELDS = {
  id: legalDocuments.id,
  docType: legalDocuments.docType,
  docNumber: legalDocuments.docNumber,
  mimeType: legalDocuments.mimeType,
  fileSize: legalDocuments.fileSize,
  scanStatus: legalDocuments.scanStatus,
  scannedAt: legalDocuments.scannedAt,
  issuedAt: legalDocuments.issuedAt,
  expiresAt: legalDocuments.expiresAt,
  verificationStatus: legalDocuments.verificationStatus,
  verifiedAt: legalDocuments.verifiedAt,
  verifiedBy: legalDocuments.verifiedBy,
  verificationNotes: legalDocuments.verificationNotes,
  verificationDeadline: legalDocuments.verificationDeadline,
  rejectionReason: legalDocuments.rejectionReason,
  uploadedAt: legalDocuments.uploadedAt,
  user: {
    id: users.id,
    email: users.email,
    firstname: users.firstname,
    lastname: users.lastname,
  },
} as const

type QueueRow = { verificationDeadline: Date | null; verificationStatus: string }

function withOverdue<T extends QueueRow>(row: T) {
  return {
    ...row,
    overdue:
      row.verificationStatus === "pending" &&
      row.verificationDeadline !== null &&
      row.verificationDeadline.getTime() < Date.now(),
  }
}

/** Load a document with its uploader, or undefined. */
async function findDocument(id: string) {
  const [row] = await db
    .select({ ...DOC_FIELDS, s3Key: legalDocuments.s3Key, userEmail: users.email })
    .from(legalDocuments)
    .innerJoin(users, eq(users.id, legalDocuments.userId))
    .where(eq(legalDocuments.id, id))
    .limit(1)
  return row
}

async function auditDecision(
  request: FastifyRequest,
  doc: { id: string; verificationStatus: string },
  action: "legal_doc_approved" | "legal_doc_rejected",
  newValue: Record<string, unknown>,
  reason?: string,
) {
  await db.insert(auditLogs).values({
    userId: request.user.sub,
    userRole: request.user.role,
    entityType: "legal_document",
    entityId: doc.id,
    action,
    oldValue: { verificationStatus: doc.verificationStatus },
    newValue,
    reason,
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"],
  })
}

export const adminLegalDocumentRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  // GET /api/admin/legal-documents — review queue, closest SLA deadline first
  fastify.get("/", async (request, reply) => {
    const parsed = legalDocQueueQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send(validationError(parsed.error.issues))
    }
    const { status, page, limit } = parsed.data

    const where = status === "all" ? undefined : eq(legalDocuments.verificationStatus, status)

    const [{ total }] = await db
      .select({ total: count() })
      .from(legalDocuments)
      .innerJoin(users, eq(users.id, legalDocuments.userId))
      .where(where)

    const rows = await db
      .select(DOC_FIELDS)
      .from(legalDocuments)
      .innerJoin(users, eq(users.id, legalDocuments.userId))
      .where(where)
      // Pending docs reviewed in SLA order; deadline-less rows (legacy uploads) last
      .orderBy(sql`${legalDocuments.verificationDeadline} ASC NULLS LAST`, asc(legalDocuments.uploadedAt))
      .limit(limit)
      .offset((page - 1) * limit)

    return reply.code(200).send({
      data: rows.map(withOverdue),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    })
  })

  // GET /api/admin/legal-documents/:id — full detail + presigned download URL
  fastify.get("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(validationError(params.error.issues))
    }

    const row = await findDocument(params.data.id)
    if (!row) {
      return reply.code(404).send({ error: "NotFound", message: "Document not found" })
    }

    const { s3Key, userEmail: _userEmail, ...doc } = row
    // Reviewers are only ever handed bytes that passed antivirus — a document
    // that isn't "clean" can't be approved anyway (see the approve gate below),
    // so we never deliver unscanned/infected content to an admin's browser.
    const downloadUrl = doc.scanStatus === "clean" ? await storage.getUrl(s3Key) : null
    return reply.code(200).send({ data: { ...withOverdue(doc), downloadUrl } })
  })

  // POST /api/admin/legal-documents/:id/approve
  fastify.post("/:id/approve", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(validationError(params.error.issues))
    }

    const doc = await findDocument(params.data.id)
    if (!doc) {
      return reply.code(404).send({ error: "NotFound", message: "Document not found" })
    }
    if (doc.verificationStatus !== "pending") {
      return reply.code(409).send({ error: "Conflict", message: `Document already ${doc.verificationStatus}` })
    }
    if (doc.scanStatus !== "clean") {
      return reply.code(409).send({
        error: "Conflict",
        message: `Cannot approve a document whose antivirus scan is "${doc.scanStatus}"`,
      })
    }

    const [updated] = await db
      .update(legalDocuments)
      .set({
        verificationStatus: "approved",
        verifiedAt: new Date(),
        verifiedBy: request.user.sub,
        updatedAt: new Date(),
      })
      // Status guard repeated in the WHERE so concurrent decisions can't both win
      .where(and(eq(legalDocuments.id, doc.id), eq(legalDocuments.verificationStatus, "pending")))
      .returning()
    if (!updated) {
      return reply.code(409).send({ error: "Conflict", message: "Document was decided concurrently" })
    }

    await auditDecision(request, doc, "legal_doc_approved", { verificationStatus: "approved" })

    // Move the customer's orders forward now that this document is approved
    await recomputeOrderLegalStatus(doc.user.id)

    // Notification is best-effort: the decision is already committed.
    sendLegalDocApprovedEmail(doc.userEmail, { docType: doc.docType as LegalDocType }).catch((err) =>
      fastify.log.error({ err, docId: doc.id }, "approval email failed"),
    )

    return reply.code(200).send({ data: updated })
  })

  // POST /api/admin/legal-documents/:id/reject — standardized reason + optional note
  fastify.post("/:id/reject", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(validationError(params.error.issues))
    }
    const body = rejectLegalDocumentSchema.safeParse(request.body ?? {})
    if (!body.success) {
      return reply.code(400).send(validationError(body.error.issues))
    }
    const { reason, notes } = body.data

    const doc = await findDocument(params.data.id)
    if (!doc) {
      return reply.code(404).send({ error: "NotFound", message: "Document not found" })
    }
    if (doc.verificationStatus !== "pending") {
      return reply.code(409).send({ error: "Conflict", message: `Document already ${doc.verificationStatus}` })
    }

    const [updated] = await db
      .update(legalDocuments)
      .set({
        verificationStatus: "rejected",
        rejectionReason: reason,
        verificationNotes: notes ?? null,
        verifiedAt: new Date(),
        verifiedBy: request.user.sub,
        updatedAt: new Date(),
      })
      .where(and(eq(legalDocuments.id, doc.id), eq(legalDocuments.verificationStatus, "pending")))
      .returning()
    if (!updated) {
      return reply.code(409).send({ error: "Conflict", message: "Document was decided concurrently" })
    }

    await auditDecision(request, doc, "legal_doc_rejected", { verificationStatus: "rejected", reason, notes }, reason)

    // Flag the customer's affected orders as docs_rejected
    await recomputeOrderLegalStatus(doc.user.id)

    sendLegalDocRejectedEmail(doc.userEmail, {
      docType: doc.docType as LegalDocType,
      reason: reason as LegalDocRejectionReason,
      notes,
    }).catch((err) => fastify.log.error({ err, docId: doc.id }, "rejection email failed"))

    return reply.code(200).send({ data: updated })
  })
}
