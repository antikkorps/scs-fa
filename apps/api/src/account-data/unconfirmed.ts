// Audit 2026-11-15 (M1) — a signup whose address is never confirmed is an
// abandoned signup, or someone holding another person's address: anonymised
// after a week, as a holder's deletion would, so the real owner can sign up.
// Only accounts that never logged in: older accounts, created before
// confirmation existed and used since, are left to the inactivity purge.
import { UNCONFIRMED_ACCOUNT_DAYS } from "@armurier/shared"
import { and, eq, isNull, lte } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { recordAuditEvent } from "../audit/record.js"
import { startDailyPurge } from "../daily-purge.js"
import { daysBefore } from "../dates.js"
import { db } from "../db/client.js"
import { users } from "../db/schema.js"
import { eraseAccount } from "./erase.js"

export async function purgeUnconfirmedAccounts(now: Date = new Date()): Promise<{ erasedAccounts: number }> {
  const due = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        isNull(users.emailVerifiedAt),
        isNull(users.lastLoginAt),
        // Admins and organisation accounts are SCS's to close.
        eq(users.role, "customer"),
        isNull(users.organisationId),
        lte(users.createdAt, daysBefore(now, UNCONFIRMED_ACCOUNT_DAYS)),
      ),
    )

  let erasedAccounts = 0
  for (const account of due) {
    const result = await eraseAccount(account.id, now, { onlyIfUnconfirmed: true })
    if (!result || "blocker" in result) continue
    // No completeErasure: no document nor newsletter to clean up, and no
    // "account deleted" mail to an address nobody proved was theirs.
    await recordAuditEvent({
      userId: account.id,
      userRole: "system",
      entityType: "user",
      entityId: account.id,
      action: "user.deleted",
      newValue: { reason: "unconfirmed_email" },
    })
    erasedAccounts++
  }
  return { erasedAccounts }
}

/** Sweep at startup, then once a day. */
export function startUnconfirmedAccountPurge(app: FastifyInstance): void {
  startDailyPurge(app, "unconfirmed account", () => purgeUnconfirmedAccounts(new Date()))
}
