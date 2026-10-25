import {
  type AnyLegalDocType,
  isLegalDocExpired,
  type LegalDocRejectionReason,
  legalDocQueueQuerySchema,
  parisToday,
  rejectLegalDocumentSchema,
  uuidParamSchema,
} from "@armurier/shared"
import { and, asc, count, eq, sql } from "drizzle-orm"
import type { FastifyPluginAsync, FastifyRequest } from "fastify"
import { recordAuditEvent } from "../audit/record.js"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import { db } from "../db/client.js"
import { legalDocuments, organisations, users } from "../db/schema.js"
import { sendLegalDocApprovedEmail, sendLegalDocRejectedEmail } from "../email.js"
import { validationError } from "../http.js"
import { recomputeOrderLegalStatus } from "../orders/legal-status.js"
import { storage } from "../storage/index.js"
import { expireLegalDocuments } from "./expiry.js"
import type { DocumentOwner } from "./upload.js"

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
  // A person's document, or (story 12.8d) an organisation's: the other is null.
  user: {
    id: users.id,
    email: users.email,
    firstname: users.firstname,
    lastname: users.lastname,
  },
  organisation: { id: organisations.id, legalName: organisations.legalName },
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

/** Documents with their owner: the person, or the organisation. */
function withOwners() {
  return db
    .select(DOC_FIELDS)
    .from(legalDocuments)
    .leftJoin(users, eq(users.id, legalDocuments.userId))
    .leftJoin(organisations, eq(organisations.id, legalDocuments.organisationId))
}

/** Load a document with its owner, or undefined. */
async function findDocument(id: string) {
  const [row] = await db
    .select({ ...DOC_FIELDS, s3Key: legalDocuments.s3Key })
    .from(legalDocuments)
    .leftJoin(users, eq(users.id, legalDocuments.userId))
    .leftJoin(organisations, eq(organisations.id, legalDocuments.organisationId))
    .where(eq(legalDocuments.id, id))
    .limit(1)
  return row
}

type FoundDocument = NonNullable<Awaited<ReturnType<typeof findDocument>>>

function ownerOf(doc: FoundDocument): DocumentOwner | null {
  if (doc.user) return { userId: doc.user.id }
  if (doc.organisation) return { organisationId: doc.organisation.id }
  return null
}

/** Who hears of the decision: the person, or the organisation's member. */
async function recipientOf(doc: FoundDocument): Promise<{ id: string; email: string } | null> {
  if (doc.user) return { id: doc.user.id, email: doc.user.email }
  if (!doc.organisation) return null
  const [member] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.organisationId, doc.organisation.id))
    .limit(1)
  return member ?? null
}

/** A decision moves the person's orders; an organisation's document is judged on the quote instead. */
async function recomputeOwnerOrders(doc: FoundDocument) {
  if (doc.user) await recomputeOrderLegalStatus(doc.user.id)
}

async function auditDecision(
  request: FastifyRequest,
  doc: { id: string; verificationStatus: string },
  action: "legal_doc_approved" | "legal_doc_rejected",
  newValue: Record<string, unknown>,
  reason?: string,
) {
  await recordAuditEvent({
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

    const [{ total }] = await db.select({ total: count() }).from(legalDocuments).where(where)

    const rows = await withOwners()
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

    const { s3Key, ...doc } = row
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
    // An expired document proves nothing: reject it as "document_expired" instead (story 12.9f).
    if (isLegalDocExpired(doc.expiresAt, parisToday())) {
      return reply
        .code(409)
        .send({ error: "DocumentExpired", message: "Cannot approve a document past its expiry date" })
    }

    // An approval past its expiry date the daily job has not marked yet would
    // still hold the customer's single approved slot for this type.
    await expireLegalDocuments(parisToday(), ownerOf(doc) ?? undefined)

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
    await recomputeOwnerOrders(doc)

    // Notification is best-effort: the decision is already committed.
    const recipient = await recipientOf(doc)
    if (recipient) {
      sendLegalDocApprovedEmail(
        recipient.email,
        { docType: doc.docType as AnyLegalDocType },
        { userId: recipient.id },
      ).catch((err) => fastify.log.error({ err, docId: doc.id }, "approval email failed"))
    }

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
    await recomputeOwnerOrders(doc)

    const recipient = await recipientOf(doc)
    if (recipient) {
      sendLegalDocRejectedEmail(
        recipient.email,
        { docType: doc.docType as AnyLegalDocType, reason: reason as LegalDocRejectionReason, notes },
        { userId: recipient.id },
      ).catch((err) => fastify.log.error({ err, docId: doc.id }, "rejection email failed"))
    }

    return reply.code(200).send({ data: updated })
  })
}
