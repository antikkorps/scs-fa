import {
  docTypesOf,
  isLegalDocExpired,
  LEGAL_DOC_TYPES,
  type LegalDocType,
  type OrderRequiredDocStatus,
  orderReference,
  PAID_PAYMENT_STATUSES,
  parisToday,
  parseRequiredDocEntries,
  type RequiredDocEntry,
  requiredDocEntryKey,
} from "@armurier/shared"
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { recordOrderStatusChange } from "../audit/record.js"
import { db } from "../db/client.js"
import { legalCategories, legalDocuments, orders } from "../db/schema.js"
import { recomputeVipStatus } from "../vip/service.js"

// Orders in these states still follow the document lifecycle: their legal status
// is re-derived from the documents on every change.
const ACTIVE_LEGAL_STATES = ["pending", "docs_verifying", "docs_rejected"] as const
// "Ready, awaiting payment" rest states: the document decision is final (later
// document changes must not undo it) — only payment advances them to `completed`.
//  - docs_verified : the dossier required documents and they were all approved
//  - payment_pending: the order required no documents at all
const READY_LEGAL_STATES = ["docs_verified", "payment_pending"] as const
// Every non-terminal state the recompute may move forward (`completed` is final).
const RECOMPUTABLE_LEGAL_STATES = [...ACTIVE_LEGAL_STATES, ...READY_LEGAL_STATES] as const

export type RequiredDocView = {
  /** The document that stands for the line: the one sent, or the first alternative. */
  docType: LegalDocType
  /** A line satisfied by any one of these (I7: hunting or shooting licence). */
  alternatives?: LegalDocType[]
  status: OrderRequiredDocStatus
  documentId?: string
  uploadedAt?: Date | null
  rejectionReason?: string | null
}

type OwnedDoc = typeof legalDocuments.$inferSelect

/** Where an entry sorts: the place of its first type in the canonical list. */
const entryRank = (entry: RequiredDocEntry) => LEGAL_DOC_TYPES.indexOf(docTypesOf(entry)[0] as LegalDocType)

/**
 * Required documents for an order = union of the entries of the
 * verification-requiring legal categories present on its lines. An entry is a
 * type, or a group of alternatives (I7); a group is dropped when one of its
 * types is required on its own anyway, since that document satisfies both.
 */
export async function requiredDocTypesFor(
  itemsJson: Array<{ legalCategory?: string | null }>,
): Promise<RequiredDocEntry[]> {
  const cats = [...new Set(itemsJson.map((i) => i.legalCategory).filter((c): c is string => Boolean(c)))]
  if (cats.length === 0) return []

  const rows = await db
    .select({
      requiresVerification: legalCategories.requiresVerification,
      requiredDocTypes: legalCategories.requiredDocTypes,
    })
    .from(legalCategories)
    .where(inArray(legalCategories.category, cats as never))

  const entries = new Map<string, RequiredDocEntry>()
  for (const row of rows) {
    if (!row.requiresVerification) continue
    for (const entry of parseRequiredDocEntries(row.requiredDocTypes)) entries.set(requiredDocEntryKey(entry), entry)
  }
  const singles = new Set([...entries.values()].filter((entry) => !Array.isArray(entry)))
  const needed = [...entries.values()].filter(
    (entry) => !Array.isArray(entry) || !entry.some((type) => singles.has(type)),
  )
  // Stable, canonical ordering
  return needed.sort((a, b) => entryRank(a) - entryRank(b))
}

/** Legal categories whose verification asks for this document type. */
async function categoriesRequiring(docType: string): Promise<Set<string>> {
  const rows = await db
    .select({ category: legalCategories.category })
    .from(legalCategories)
    .where(
      and(
        eq(legalCategories.requiresVerification, true),
        // On its own, or within a group of alternatives (I7).
        sql`(${legalCategories.requiredDocTypes} @> ${JSON.stringify([docType])}::jsonb or ${legalCategories.requiredDocTypes} @> ${JSON.stringify([[docType]])}::jsonb)`,
      ),
    )
  return new Set(rows.map((row) => row.category))
}

/**
 * The customer's orders still waiting on their documents that ask for this
 * document type, newest first, each with only the lines that ask for it — so a
 * reviewer sees which weapon the document is for (audit 2026-11-01, I9).
 */
export async function ordersAwaitingDocType(userId: string, docType: string) {
  const [open, categories] = await Promise.all([
    db
      .select({
        id: orders.id,
        createdAt: orders.createdAt,
        legalVerificationStatus: orders.legalVerificationStatus,
        paymentStatus: orders.paymentStatus,
        itemsJson: orders.itemsJson,
      })
      .from(orders)
      .where(and(eq(orders.userId, userId), inArray(orders.legalVerificationStatus, [...ACTIVE_LEGAL_STATES])))
      .orderBy(desc(orders.createdAt)),
    categoriesRequiring(docType),
  ])

  return open.flatMap(({ itemsJson, ...order }) => {
    const items = itemsJson
      .filter((item) => item.legalCategory && categories.has(item.legalCategory))
      .map((item) => ({ name: item.name, legalCategory: item.legalCategory }))
    if (items.length === 0) return []
    return [{ ...order, reference: orderReference(order.id), items }]
  })
}

/** An approval no longer counts once the document's expiry date has passed (story 12.9f). */
function isValidApproval(doc: OwnedDoc, today: string): boolean {
  return doc.verificationStatus === "approved" && !isLegalDocExpired(doc.expiresAt, today)
}

/**
 * The document that represents a required entry for review purposes: a
 * still-valid approved one of its types if it exists, otherwise the latest
 * upload of any of them (so re-uploading after a rejection or an expiry — or
 * sending the other licence, I7 — supersedes the old document, clarification D1).
 */
function representativeDoc(docs: OwnedDoc[], entry: RequiredDocEntry, today: string): OwnedDoc | undefined {
  const types: ReadonlyArray<string> = docTypesOf(entry)
  const candidates = docs.filter((d) => types.includes(d.docType))
  return candidates.find((d) => isValidApproval(d, today)) ?? candidates[0]
}

function docStatus(doc: OwnedDoc | undefined, today: string): OrderRequiredDocStatus {
  if (!doc) return "missing"
  if (doc.verificationStatus === "rejected") return "rejected"
  // An expired document needs a re-upload, exactly like a rejected one,
  // whether the daily job has already marked it or not.
  if (doc.verificationStatus === "expired" || isLegalDocExpired(doc.expiresAt, today)) return "rejected"
  if (doc.verificationStatus === "approved") return "approved"
  if (doc.scanStatus === "infected") return "infected"
  if (doc.scanStatus === "pending") return "pending_scan"
  return "pending_review"
}

export function buildRequiredDocsView(
  required: RequiredDocEntry[],
  docs: OwnedDoc[],
  today = parisToday(),
): RequiredDocView[] {
  return required.map((entry) => {
    const doc = representativeDoc(docs, entry, today)
    const status = docStatus(doc, today)
    return {
      docType: (doc?.docType as LegalDocType | undefined) ?? (docTypesOf(entry)[0] as LegalDocType),
      ...(Array.isArray(entry) && { alternatives: entry }),
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
 * Re-derive the combined legal/payment lifecycle of the user's non-terminal
 * orders. Called whenever a document changes (upload, delete, scan result, admin
 * approval/rejection) or a payment settles, so both admin decisions and incoming
 * payments move customer orders forward.
 *
 * `legalVerificationStatus` is the order's overall lifecycle field:
 *   pending → docs_verifying → docs_verified ─┐
 *                                             ├─ (payment received) → completed
 *   payment_pending (no documents required) ──┘
 *   docs_rejected ↺ (customer re-uploads)
 * `completed` requires BOTH the legal dossier cleared (or none required) AND the
 * payment received; it is terminal.
 */
export async function recomputeOrderLegalStatus(userId: string): Promise<void> {
  const candidates = await db
    .select({
      id: orders.id,
      legalVerificationStatus: orders.legalVerificationStatus,
      legalRejectionReason: orders.legalRejectionReason,
      paymentStatus: orders.paymentStatus,
      itemsJson: orders.itemsJson,
    })
    .from(orders)
    .where(and(eq(orders.userId, userId), inArray(orders.legalVerificationStatus, [...RECOMPUTABLE_LEGAL_STATES])))
  if (candidates.length === 0) return

  const docs = await loadUserDocs(userId)
  // An order reaching `completed` may unlock VIP: paid AND documents validated (story 12.9e).
  let completedOne = false

  for (const order of candidates) {
    const paid = PAID_PAYMENT_STATUSES.includes(order.paymentStatus)

    // "Ready, awaiting payment" states: the document decision is final, only
    // payment advances them. Nothing to do until the order is paid.
    if ((READY_LEGAL_STATES as readonly string[]).includes(order.legalVerificationStatus)) {
      if (!paid) continue
      const [completed] = await db
        .update(orders)
        .set({ legalVerificationStatus: "completed", updatedAt: new Date() })
        .where(and(eq(orders.id, order.id), inArray(orders.legalVerificationStatus, [...READY_LEGAL_STATES])))
        .returning({ id: orders.id })
      if (completed) {
        await recordOrderStatusChange(order.id, "legal", { from: order.legalVerificationStatus, to: "completed" })
        completedOne = true
      }
      continue
    }

    // Active states: re-derive from the document lifecycle.
    const requiredTypes = await requiredDocTypesFor(order.itemsJson)
    if (requiredTypes.length === 0) continue

    const aggregate = aggregateLegalStatus(buildRequiredDocsView(requiredTypes, docs))
    const verified = aggregate.status === "docs_verified"
    // Once the dossier is verified, a paid order completes outright; otherwise it
    // rests in docs_verified until payment lands.
    const next = verified && paid ? "completed" : aggregate.status

    if (next === order.legalVerificationStatus && aggregate.rejectionReason === order.legalRejectionReason) {
      continue
    }

    // The admin who completed the dossier = reviewer of the latest approved doc
    const lastApprover = verified
      ? docs
          .filter((d) => d.verificationStatus === "approved" && d.verifiedAt)
          .sort((a, b) => (b.verifiedAt as Date).getTime() - (a.verifiedAt as Date).getTime())[0]?.verifiedBy
      : null

    const [moved] = await db
      .update(orders)
      .set({
        legalVerificationStatus: next,
        legalRejectionReason: aggregate.rejectionReason,
        legalVerifiedAt: verified ? new Date() : null,
        legalVerifiedBy: verified ? lastApprover : null,
        updatedAt: new Date(),
      })
      // The guard keeps a concurrent payment transition from being overwritten:
      // we only move orders that are still in an active state.
      .where(and(eq(orders.id, order.id), inArray(orders.legalVerificationStatus, [...ACTIVE_LEGAL_STATES])))
      .returning({ id: orders.id })
    // A new rejection reason alone is no new step.
    if (moved && next !== order.legalVerificationStatus) {
      await recordOrderStatusChange(order.id, "legal", { from: order.legalVerificationStatus, to: next })
      if (next === "completed") completedOne = true
    }
  }

  if (completedOne) await recomputeVipStatus(userId)
}
