// Story 12.11 — an account nobody uses is not kept forever (decided with Franck
// on 2026-11-01): no login, no session in use and no order for 3 years → a warning e-mail, then
// the same anonymisation as a holder's deletion 30 days later, unless a login
// came in between. Admins and organisation accounts are closed by SCS, never
// here. Also purges the documents a deleted account's orders relied on, once
// their 10 years are over.
import { INACTIVE_ACCOUNT_YEARS, INACTIVITY_NOTICE_DAYS, USED_LEGAL_DOCUMENT_RETENTION_YEARS } from "@armurier/shared"
import { and, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm"
import type { FastifyBaseLogger, FastifyInstance } from "fastify"
import { recordAuditEvent } from "../audit/record.js"
import { startDailyPurge } from "../daily-purge.js"
import { daysBefore, yearsBefore } from "../dates.js"
import { db } from "../db/client.js"
import { legalDocuments, orders, refreshTokens, users } from "../db/schema.js"
import { sendInactiveAccountWarningEmail } from "../email.js"
import { storage } from "../storage/index.js"
import { completeErasure, eraseAccount } from "./erase.js"

type Logger = Pick<FastifyBaseLogger, "warn" | "error">

const SILENT: Logger = { warn: () => undefined, error: () => undefined }

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Last sign of life: a login, a session kept alive (sessions slide for days
 * without a fresh login), an order — else the account's creation.
 */
const lastActivity = sql`greatest(
  coalesce(${users.lastLoginAt}, ${users.createdAt}),
  (select max(${refreshTokens.lastUsedAt}) from ${refreshTokens} where ${refreshTokens.userId} = ${users.id}),
  (select max(${orders.createdAt}) from ${orders} where ${orders.userId} = ${users.id})
)`

/** Accounts the holder deletes themself; admins and organisations are SCS's to close. */
const purgeableAccount = and(isNull(users.deletedAt), eq(users.role, "customer"), isNull(users.organisationId))

export async function purgeInactiveAccounts(
  now: Date = new Date(),
  log: Logger = SILENT,
): Promise<{ warnedAccounts: number; erasedAccounts: number; keptDocumentsPurged: number }> {
  return {
    warnedAccounts: await warnInactiveAccounts(now, log),
    erasedAccounts: await eraseWarnedAccounts(now, log),
    keptDocumentsPurged: await purgeKeptLegalDocuments(now, log),
  }
}

async function warnInactiveAccounts(now: Date, log: Logger): Promise<number> {
  const cutoff = yearsBefore(now, INACTIVE_ACCOUNT_YEARS)

  // Claimed before the e-mail leaves, so two sweeps never warn twice; released
  // on a failed send, so tomorrow's sweep tries again.
  const claimed = await db
    .update(users)
    .set({ inactivityWarnedAt: now })
    .where(
      and(
        purgeableAccount,
        sql`${lastActivity} < ${cutoff}`,
        // Never warned, or warned before a later login: this is a new silence.
        or(isNull(users.inactivityWarnedAt), sql`${users.inactivityWarnedAt} < ${lastActivity}`),
      ),
    )
    .returning({ id: users.id, email: users.email })

  const deletionDate = new Date(now.getTime() + INACTIVITY_NOTICE_DAYS * DAY_MS)
  let warned = 0
  for (const account of claimed) {
    try {
      await sendInactiveAccountWarningEmail(account.email, { deletionDate }, { userId: account.id })
      warned++
    } catch (err) {
      await db.update(users).set({ inactivityWarnedAt: null }).where(eq(users.id, account.id))
      log.warn({ err, userId: account.id }, "Inactive account warning failed — retried on the next sweep")
    }
  }
  return warned
}

async function eraseWarnedAccounts(now: Date, log: Logger): Promise<number> {
  const due = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        purgeableAccount,
        lte(users.inactivityWarnedAt, daysBefore(now, INACTIVITY_NOTICE_DAYS)),
        // No sign of life since the warning.
        sql`${lastActivity} < ${users.inactivityWarnedAt}`,
      ),
    )

  let erased = 0
  for (const account of due) {
    const result = await eraseAccount(account.id, now)
    // An order still running waits for its end; the next sweeps check again.
    if (!result || "blocker" in result) continue
    await recordAuditEvent({
      userId: account.id,
      userRole: "system",
      entityType: "user",
      entityId: account.id,
      action: "user.deleted",
      newValue: { reason: "inactivity", documentsKept: result.documentsKept },
    })
    await completeErasure(account.id, result, log)
    erased++
  }
  return erased
}

/** Documents kept for a deleted account, once its last verified order is past the legal period. */
async function purgeKeptLegalDocuments(now: Date, log: Logger): Promise<number> {
  const lastVerification = db
    .select({ at: sql`max(${orders.legalVerifiedAt})` })
    .from(orders)
    .where(eq(orders.userId, users.id))
  const expiredAccounts = db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        isNotNull(users.deletedAt),
        lt(
          sql`coalesce((${lastVerification}), ${users.deletedAt})`,
          yearsBefore(now, USED_LEGAL_DOCUMENT_RETENTION_YEARS),
        ),
      ),
    )
  const purged = await db
    .delete(legalDocuments)
    .where(inArray(legalDocuments.userId, expiredAccounts))
    .returning({ key: legalDocuments.s3Key })
  for (const { key } of purged) {
    await storage.delete(key).catch((err) => log.error({ err }, "kept document purge: file delete failed"))
  }
  return purged.length
}

/** Sweep at startup, then once a day. */
export function startInactiveAccountPurge(app: FastifyInstance): void {
  startDailyPurge(app, "inactive account", () => purgeInactiveAccounts(new Date(), app.log))
}
