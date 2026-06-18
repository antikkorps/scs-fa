import { eq } from "drizzle-orm"
import { db } from "../db/client.js"
import { legalDocuments } from "../db/schema.js"
import { env } from "../env.js"
import { recomputeOrderLegalStatus } from "../orders/legal-status.js"
import { storage } from "../storage/index.js"
import { scanBuffer } from "./clamav.js"

// Antivirus scan for uploaded legal documents.
//
// In production (CLAMAV_ENABLED=true) the stored bytes are streamed to a ClamAV
// daemon; the verdict flips `scan_status` to "clean" or "infected". A document
// is only usable downstream — viewable, approvable — once it is "clean".
//
// When ClamAV is disabled (dev/test/CI default, no daemon available) we mark
// uploads "clean" so the rest of the workflow can be exercised. This stub is
// gated strictly on the env flag; production MUST set CLAMAV_ENABLED=true.
//
// Modelled as an async hook: the upload route records the document "pending" and
// triggers this without blocking the response.

export type ScanOutcome = "clean" | "infected" | "error"

async function runScan(documentId: string): Promise<ScanOutcome> {
  if (!env.CLAMAV_ENABLED) return "clean" // dev/test stub — see note above

  const [doc] = await db
    .select({ s3Key: legalDocuments.s3Key })
    .from(legalDocuments)
    .where(eq(legalDocuments.id, documentId))
    .limit(1)
  if (!doc) return "error"

  // A storage or daemon failure must NEVER read as clean — leave it unresolved.
  let bytes: Buffer
  try {
    bytes = await storage.getBytes(doc.s3Key)
  } catch {
    return "error"
  }
  return scanBuffer(bytes)
}

export async function scanDocument(documentId: string): Promise<ScanOutcome> {
  const outcome = await runScan(documentId)

  // Scanner/storage unreachable: keep the document "pending" (still unusable) so
  // it is retried/escalated rather than silently treated as safe.
  if (outcome === "error") return "error"

  const [updated] = await db
    .update(legalDocuments)
    .set({ scanStatus: outcome, scannedAt: new Date() })
    .where(eq(legalDocuments.id, documentId))
    .returning({ userId: legalDocuments.userId })

  // An infected verdict pushes orders back to pending (re-upload required)
  if (updated) await recomputeOrderLegalStatus(updated.userId)

  return outcome
}
