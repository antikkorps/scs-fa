import { eq } from "drizzle-orm"
import { db } from "../db/client.js"
import { legalDocuments } from "../db/schema.js"
import { recomputeOrderLegalStatus } from "../orders/legal-status.js"

// Antivirus scan — STUB.
//
// In production this will pull the stored bytes and run them through ClamAV (or
// an equivalent), then flip `scan_status` to "clean" or "infected". For now the
// stub marks every freshly uploaded document "clean" so the rest of the legal
// workflow can be built and tested. A document is only usable downstream once
// its scan_status is "clean".
//
// Modelled as an async hook: the upload route records the document as "pending"
// and triggers this without blocking the response.
export async function scanDocument(documentId: string): Promise<"clean" | "infected"> {
  // Real implementation: fetch object from storage, stream through ClamAV.
  const result: "clean" | "infected" = "clean"

  const [updated] = await db
    .update(legalDocuments)
    .set({ scanStatus: result, scannedAt: new Date() })
    .where(eq(legalDocuments.id, documentId))
    .returning({ userId: legalDocuments.userId })

  // An infected verdict pushes orders back to pending (re-upload required)
  if (updated) await recomputeOrderLegalStatus(updated.userId)

  return result
}
