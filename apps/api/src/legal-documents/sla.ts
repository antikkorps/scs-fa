import type { LegalDocType } from "@armurier/shared"
import { and, eq, inArray, isNull, lt } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { db } from "../db/client.js"
import { auditLogs, legalDocuments, users } from "../db/schema.js"
import { type SlaBreachItem, sendLegalDocSlaBreachEmail } from "../email.js"
import { env } from "../env.js"

const HOUR_MS = 60 * 60 * 1000

export type SlaBreachSummary = { breached: number; notified: boolean }

/**
 * Detect legal documents that blew past their 48h review SLA and alert admins.
 *
 * A breach = a still-`pending` document whose `verificationDeadline` is in the
 * past and which has never been alerted (`slaBreachNotifiedAt IS NULL`). We
 * email the admins once per breach, then stamp `slaBreachNotifiedAt` and write
 * an audit entry so the next run won't re-alert. The email is sent *before*
 * marking so a delivery failure simply retries on the next run rather than
 * silently swallowing the alert.
 */
export async function runLegalDocSlaBreachCheck(now: Date = new Date()): Promise<SlaBreachSummary> {
  const breached = await db
    .select({
      id: legalDocuments.id,
      docType: legalDocuments.docType,
      deadline: legalDocuments.verificationDeadline,
      firstname: users.firstname,
      lastname: users.lastname,
      email: users.email,
    })
    .from(legalDocuments)
    .innerJoin(users, eq(users.id, legalDocuments.userId))
    .where(
      and(
        eq(legalDocuments.verificationStatus, "pending"),
        isNull(legalDocuments.slaBreachNotifiedAt),
        lt(legalDocuments.verificationDeadline, now),
      ),
    )
  if (breached.length === 0) return { breached: 0, notified: false }

  const admins = await db.select({ email: users.email }).from(users).where(eq(users.role, "admin"))
  // No admins to notify yet: leave the breaches unmarked so a later run retries.
  if (admins.length === 0) return { breached: breached.length, notified: false }

  const items: SlaBreachItem[] = breached.map((d) => ({
    customerName: `${d.firstname} ${d.lastname}`.trim() || d.email,
    docType: d.docType as LegalDocType,
    deadline: d.deadline as Date,
    hoursOverdue: Math.floor((now.getTime() - (d.deadline as Date).getTime()) / HOUR_MS),
  }))

  // Send first: if delivery fails, nothing is marked and the next run retries.
  await sendLegalDocSlaBreachEmail(
    admins.map((a) => a.email),
    items,
  )

  const ids = breached.map((d) => d.id)
  await db.transaction(async (tx) => {
    await tx
      .update(legalDocuments)
      .set({ slaBreachNotifiedAt: now })
      // Re-check the guard so a concurrent run can't double-mark / double-audit
      .where(and(inArray(legalDocuments.id, ids), isNull(legalDocuments.slaBreachNotifiedAt)))
    await tx.insert(auditLogs).values(
      breached.map((d, i) => ({
        userId: null,
        userRole: "system",
        entityType: "legal_document",
        entityId: d.id,
        action: "legal_doc_sla_breached",
        newValue: { deadline: (d.deadline as Date).toISOString(), hoursOverdue: items[i].hoursOverdue },
      })),
    )
  })

  return { breached: breached.length, notified: true }
}

/**
 * Start the in-process SLA breach scheduler. No-op under tests or when the
 * interval is 0 — production can instead drive `sla-cli.ts` from an external
 * cron. Cleared on server close.
 */
export function startLegalDocSlaScheduler(app: FastifyInstance): void {
  const minutes = env.SLA_CHECK_INTERVAL_MINUTES
  if (env.NODE_ENV === "test" || minutes <= 0) return

  const timer = setInterval(
    () => {
      runLegalDocSlaBreachCheck()
        .then((r) => {
          if (r.breached > 0) app.log.warn(r, "legal doc SLA breach check")
        })
        .catch((err) => app.log.error({ err }, "legal doc SLA breach check failed"))
    },
    minutes * 60 * 1000,
  )
  timer.unref?.()
  app.addHook("onClose", async () => clearInterval(timer))
  app.log.info({ minutes }, "legal doc SLA breach scheduler started")
}
