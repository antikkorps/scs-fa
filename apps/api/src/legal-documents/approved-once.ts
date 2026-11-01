import { and, eq, isNotNull, or, type SQL, sql } from "drizzle-orm"
import { legalDocuments } from "../db/schema.js"

/**
 * A document SCS approved — still valid, or since expired — is the proof
 * behind a cleared purchase, kept as long as the purchase's records: its holder
 * may not delete it (story 12.9f, widened after the 2026-11-01 audit, M1).
 * Only pending and approved documents ever expire, and an approval stamps
 * `verified_at`: an expired document with that stamp was approved.
 */
export const approvedOnce: SQL =
  or(
    eq(legalDocuments.verificationStatus, "approved"),
    and(eq(legalDocuments.verificationStatus, "expired"), isNotNull(legalDocuments.verifiedAt)),
  ) ?? sql`true` // or() is only undefined without arguments: never here
