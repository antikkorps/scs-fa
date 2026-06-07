import { LEGAL_DOC_TYPES, type LegalDocType, type OrderRequiredDocStatus } from "@armurier/shared"
import { and, desc, eq, inArray } from "drizzle-orm"
import { db } from "../db/client.js"
import { legalCategories, legalDocuments, orders } from "../db/schema.js"

// Orders in these states no longer follow the document lifecycle: once the
// dossier has been verified, later document changes must not undo the decision.
const ACTIVE_LEGAL_STATES = ["pending", "docs_verifying", "docs_rejected"] as const

export type RequiredDocView = {
  docType: LegalDocType
  status: OrderRequiredDocStatus
  documentId?: string
  uploadedAt?: Date | null
  rejectionReason?: string | null
}

type OwnedDoc = typeof legalDocuments.$inferSelect

/**
 * Required doc types for an order = union of the `requiredDocTypes` of the
 * verification-requiring legal categories present on its lines.
 */
export async function requiredDocTypesFor(
  itemsJson: Array<{ legalCategory?: string | null }>,
): Promise<LegalDocType[]> {
  const cats = [...new Set(itemsJson.map((i) => i.legalCategory).filter((c): c is string => Boolean(c)))]
  if (cats.length === 0) return []

  const rows = await db
    .select({
      requiresVerification: legalCategories.requiresVerification,
      requiredDocTypes: legalCategories.requiredDocTypes,
    })
    .from(legalCategories)
    .where(inArray(legalCategories.category, cats as never))

  const types = new Set<string>()
  for (const row of rows) {
    if (!row.requiresVerification) continue
    for (const t of row.requiredDocTypes ?? []) types.add(t)
  }
  // Stable, canonical ordering
  return LEGAL_DOC_TYPES.filter((t) => types.has(t))
}

/**
 * The document that represents a doc type for review purposes: an approved one
 * if it exists, otherwise the latest upload (so re-uploading after a rejection
 * supersedes the rejected document — clarification D1).
 */
function representativeDoc(docs: OwnedDoc[], docType: LegalDocType): OwnedDoc | undefined {
  const ofType = docs.filter((d) => d.docType === docType)
  return ofType.find((d) => d.verificationStatus === "approved") ?? ofType[0]
}

function docStatus(doc: OwnedDoc | undefined): OrderRequiredDocStatus {
  if (!doc) return "missing"
  if (doc.verificationStatus === "approved") return "approved"
  // "expired" documents need a re-upload, exactly like rejected ones
  if (doc.verificationStatus === "rejected" || doc.verificationStatus === "expired") return "rejected"
  if (doc.scanStatus === "infected") return "infected"
  if (doc.scanStatus === "pending") return "pending_scan"
  return "pending_review"
}

export function buildRequiredDocsView(requiredTypes: LegalDocType[], docs: OwnedDoc[]): RequiredDocView[] {
  return requiredTypes.map((docType) => {
    const doc = representativeDoc(docs, docType)
    const status = docStatus(doc)
    return {
      docType,
      status,
      ...(doc && {
        documentId: doc.id,
        uploadedAt: doc.uploadedAt,
        ...(status === "rejected" && { rejectionReason: doc.rejectionReason ?? "document_expired" }),
      }),
    }
  })
}

type Aggregate = {
  status: "pending" | "docs_verifying" | "docs_verified" | "docs_rejected"
  rejectionReason: string | null
}

/** Collapse the per-doc checklist into the order-level legal status. */
export function aggregateLegalStatus(view: RequiredDocView[]): Aggregate {
  const rejected = view.find((d) => d.status === "rejected")
  if (rejected) return { status: "docs_rejected", rejectionReason: rejected.rejectionReason ?? null }
  if (view.some((d) => d.status === "missing" || d.status === "infected")) {
    return { status: "pending", rejectionReason: null }
  }
  if (view.every((d) => d.status === "approved")) return { status: "docs_verified", rejectionReason: null }
  return { status: "docs_verifying", rejectionReason: null }
}

/** All legal documents of a user, newest first. */
export async function loadUserDocs(userId: string): Promise<OwnedDoc[]> {
  return db
    .select()
    .from(legalDocuments)
    .where(eq(legalDocuments.userId, userId))
    .orderBy(desc(legalDocuments.uploadedAt))
}

/**
 * Re-derive the legal status of the user's active orders from their document
 * lifecycle. Called whenever a document changes (upload, delete, scan result,
 * admin approval/rejection) so admin decisions move customer orders forward.
 */
export async function recomputeOrderLegalStatus(userId: string): Promise<void> {
  const activeOrders = await db
    .select({
      id: orders.id,
      legalVerificationStatus: orders.legalVerificationStatus,
      legalRejectionReason: orders.legalRejectionReason,
      itemsJson: orders.itemsJson,
    })
    .from(orders)
    .where(and(eq(orders.userId, userId), inArray(orders.legalVerificationStatus, [...ACTIVE_LEGAL_STATES])))
  if (activeOrders.length === 0) return

  const docs = await loadUserDocs(userId)

  for (const order of activeOrders) {
    const requiredTypes = await requiredDocTypesFor(order.itemsJson)
    if (requiredTypes.length === 0) continue

    const view = buildRequiredDocsView(requiredTypes, docs)
    const next = aggregateLegalStatus(view)
    if (next.status === order.legalVerificationStatus && next.rejectionReason === order.legalRejectionReason) {
      continue
    }

    const verified = next.status === "docs_verified"
    // The admin who completed the dossier = reviewer of the latest approved doc
    const lastApprover = verified
      ? docs
          .filter((d) => d.verificationStatus === "approved" && d.verifiedAt)
          .sort((a, b) => (b.verifiedAt as Date).getTime() - (a.verifiedAt as Date).getTime())[0]?.verifiedBy
      : null

    await db
      .update(orders)
      .set({
        legalVerificationStatus: next.status,
        legalRejectionReason: next.rejectionReason,
        legalVerifiedAt: verified ? new Date() : null,
        legalVerifiedBy: verified ? lastApprover : null,
        updatedAt: new Date(),
      })
      // Recompute only ever moves between active states (or into docs_verified);
      // the guard keeps a concurrent payment transition from being overwritten.
      .where(and(eq(orders.id, order.id), inArray(orders.legalVerificationStatus, [...ACTIVE_LEGAL_STATES])))
  }
}
