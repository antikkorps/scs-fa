// Story 12.7c — delivery reports: "sent, but refused by her mailbox".
// The provider's adapter turns its payload into reports named by the tracking
// id we journaled at sending; each report joins the same order (or account) as
// one more event of its history. Nothing here knows which provider is behind.

import { and, eq, like } from "drizzle-orm"
import type { FastifyBaseLogger, FastifyPluginAsync } from "fastify"
import { recordAuditEvent } from "../audit/record.js"
import { db } from "../db/client.js"
import { auditLogs } from "../db/schema.js"
import { env } from "../env.js"
import { matchesSecret } from "../net/shared-secret.js"
import { deliveryProvider } from "./provider.js"
import type { DeliveryOutcome, DeliveryReport } from "./types.js"

const RESULTS: Record<DeliveryOutcome, "success" | "failure"> = {
  delivered: "success",
  hard_bounce: "failure",
  blocked: "failure",
  spam: "failure",
}

/** The journal line of the e-mail a report is about, if we sent it. */
async function findSentLine(trackingId: string) {
  const [sent] = await db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.messageId, trackingId), like(auditLogs.action, "email.%.sent")))
    .limit(1)
  return sent
}

// Providers retry a report they think was lost: one line per e-mail and outcome.
async function alreadyRecorded(trackingId: string, action: string): Promise<boolean> {
  const [known] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(and(eq(auditLogs.messageId, trackingId), eq(auditLogs.action, action)))
    .limit(1)
  return Boolean(known)
}

async function recordReport({ trackingId, outcome }: DeliveryReport, log: FastifyBaseLogger): Promise<void> {
  const sent = await findSentLine(trackingId)
  if (!sent) {
    log.warn({ outcome }, "Delivery report for an e-mail we did not journal — ignored")
    return
  }
  const action = `email.${sent.action.split(".")[1]}.${outcome}`
  if (await alreadyRecorded(trackingId, action)) return

  const result = RESULTS[outcome]
  await recordAuditEvent({
    userRole: "system",
    entityType: sent.entityType,
    entityId: sent.entityId,
    orderId: sent.orderId,
    action,
    result,
    error: result === "failure" ? `delivery.${outcome}` : null,
    messageId: trackingId,
    newValue: sent.newValue,
  })
  log.info({ orderId: sent.orderId, outcome }, "Delivery report recorded")
}

// Mounted under /api/webhooks/email. No JWT: the provider presents the shared secret.
export const deliveryWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/", async (request, reply) => {
    if (!deliveryProvider || !env.EMAIL_WEBHOOK_SECRET) {
      return reply.code(503).send({ error: "NotConfigured", message: "Delivery reports are not configured" })
    }
    const secret = deliveryProvider.presentedSecret(request.headers.authorization)
    if (!matchesSecret(secret, env.EMAIL_WEBHOOK_SECRET)) {
      request.log.warn("Delivery webhook secret rejected")
      return reply.code(401).send({ error: "Unauthorized", message: "Invalid webhook secret" })
    }

    const reports = deliveryProvider.parseReports(request.body)
    if (!reports) {
      return reply.code(400).send({ error: "ValidationError", message: "Not a delivery report" })
    }
    for (const report of reports) await recordReport(report, request.log)
    return reply.code(200).send({ received: true })
  })
}
