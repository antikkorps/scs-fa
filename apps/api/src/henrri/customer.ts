// Story 12.6 — the invoices and credit notes a customer can see and download.

import { and, asc, eq, sql } from "drizzle-orm"
import { db } from "../db/client.js"
import { henrriDocuments } from "../db/schema.js"

/** The documents Henrri has issued on an order, invoice first — never one still on its way. */
export async function issuedDocumentsOfOrder(orderId: string) {
  const rows = await db
    .select()
    .from(henrriDocuments)
    .where(and(eq(henrriDocuments.orderId, orderId), eq(henrriDocuments.status, "finalized")))
    .orderBy(sql`${henrriDocuments.kind} = 'credit_note'`, asc(henrriDocuments.finalizedAt))
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    number: row.henrriNumber,
    amountTtc: Number(row.expectedTotalTtc),
    issuedAt: row.finalizedAt,
  }))
}

/** One issued document of the order, with what is needed to fetch its PDF. */
export async function issuedDocument(orderId: string, documentId: string) {
  const [row] = await db
    .select({
      kind: henrriDocuments.kind,
      number: henrriDocuments.henrriNumber,
      henrriDocumentId: henrriDocuments.henrriDocumentId,
    })
    .from(henrriDocuments)
    .where(
      and(
        eq(henrriDocuments.id, documentId),
        eq(henrriDocuments.orderId, orderId),
        eq(henrriDocuments.status, "finalized"),
      ),
    )
    .limit(1)
  if (!row?.henrriDocumentId || !row.number) return null
  return { kind: row.kind, number: row.number, henrriDocumentId: row.henrriDocumentId }
}

/** The download name: "Facture-26-10-1.pdf", "Avoir-26-10-2.pdf". */
export function pdfFileName(document: { kind: string; number: string }): string {
  const name = document.kind === "invoice" ? "Facture" : "Avoir"
  return `${name}-${document.number.replace(/[^\w.-]/g, "_")}.pdf`
}
