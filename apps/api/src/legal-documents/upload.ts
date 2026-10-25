// The upload of a supporting document, whoever it belongs to: a person
// (story 4.x) or, since story 12.8d, an organisation. Multipart parsing, the
// per-feature size cap, the real file type checked against the declared one,
// storage, then the antivirus scan out of band.

import { randomUUID } from "node:crypto"
import {
  ALLOWED_LEGAL_DOC_MIME_TYPES,
  type AllowedLegalDocMimeType,
  fileContentMatchesDeclaredMime,
  isLegalDocExpired,
  LEGAL_DOC_REVIEW_SLA_HOURS,
  MAX_LEGAL_DOC_SIZE_BYTES,
  parisToday,
} from "@armurier/shared"
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from "fastify"
import type { z } from "zod"
import { db } from "../db/client.js"
import { legalDocuments } from "../db/schema.js"
import { validationError } from "../http.js"
import { storage } from "../storage/index.js"
import { scanDocument } from "./scan.js"

// Fields returned to the owner — never the raw storage URL (read access is
// granted on demand through a short-lived presigned URL).
export const OWNER_DOC_FIELDS = {
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

/** Whose document it is: a person's, or an organisation's — never both. */
export type DocumentOwner = { userId: string } | { organisationId: string }

function storageFolder(owner: DocumentOwner): string {
  return "userId" in owner ? `legal-documents/${owner.userId}` : `legal-documents/organisations/${owner.organisationId}`
}

interface DocumentMeta {
  docType: (typeof legalDocuments.$inferInsert)["docType"]
  docNumber?: string
  issuedAt?: string
  expiresAt?: string
}

/**
 * Reads, checks and stores an uploaded document for `owner`. A refusal is
 * answered here and gives null; the stored document is returned for the
 * caller to answer. The metadata schema decides which types this owner may file.
 */
export async function receiveDocument(
  request: FastifyRequest,
  reply: FastifyReply,
  options: { owner: DocumentOwner; metaSchema: z.ZodType<DocumentMeta>; log: FastifyBaseLogger },
) {
  const refuse = (status: number, body: object) => {
    reply.code(status).send(body)
    return null
  }
  if (!request.isMultipart()) {
    return refuse(400, { error: "BadRequest", message: "Expected a multipart/form-data request" })
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
        // The plugin's global ceiling bounds memory; this is the per-feature
        // cap, because a legal document has no reason to be as large as the
        // print-grade Gun Art originals that ceiling exists for (story 11.5).
        if (part.file.truncated || buffer.length > MAX_LEGAL_DOC_SIZE_BYTES) {
          return refuse(413, { error: "PayloadTooLarge", message: "File exceeds the maximum allowed size" })
        }
        file = { buffer, mimetype: part.mimetype }
      } else {
        fields[part.fieldname] = String(part.value)
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("maximum file size")) {
      return refuse(413, { error: "PayloadTooLarge", message: "File exceeds the maximum allowed size" })
    }
    throw err
  }

  if (!file) {
    return refuse(400, { error: "BadRequest", message: 'A file part named "file" is required' })
  }
  if (!isAllowedMime(file.mimetype)) {
    return refuse(400, {
      error: "UnsupportedMediaType",
      message: `Unsupported file type. Allowed: ${ALLOWED_LEGAL_DOC_MIME_TYPES.join(", ")}`,
    })
  }
  // Never trust the client-declared Content-Type: sniff the real type from the
  // payload's magic bytes and require it to match. Blocks mislabeled/polyglot
  // uploads (e.g. an SVG/HTML XSS payload announced as image/png).
  if (!fileContentMatchesDeclaredMime(file.buffer, file.mimetype)) {
    return refuse(400, { error: "UnsupportedMediaType", message: "File content does not match its declared type" })
  }

  const meta = options.metaSchema.safeParse(fields)
  if (!meta.success) return refuse(400, validationError(meta.error.issues))
  if (isLegalDocExpired(meta.data.expiresAt, parisToday())) {
    return refuse(400, { error: "DocumentExpired", message: "This document has already expired" })
  }

  const id = randomUUID()
  const key = `${storageFolder(options.owner)}/${id}.${MIME_EXTENSION[file.mimetype]}`
  const stored = await storage.put({ key, body: file.buffer, contentType: file.mimetype })

  const created = await db
    .insert(legalDocuments)
    .values({
      id,
      ...options.owner,
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
    .returning(OWNER_DOC_FIELDS)
    .then(([row]) => row)
    .catch(async (err) => {
      // Compensate: don't leave an orphaned object if the row insert fails.
      await storage.delete(key).catch(() => {})
      throw err
    })

  return created
}

/**
 * The antivirus scan, out of band: the response reports scanStatus "pending".
 * Started by the caller once its own follow-up is done — its verdict recomputes
 * the owner's orders, which must not race the caller's recompute.
 */
export function scanInBackground(id: string, log: FastifyBaseLogger): void {
  void scanDocument(id).catch((err) => log.error({ err, id }, "legal document scan failed"))
}
