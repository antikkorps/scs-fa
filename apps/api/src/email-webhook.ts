// Story 12.7c — Brevo's delivery reports: "sent, but refused by her mailbox".
// Brevo names each report by the SMTP message id we journaled at sending; the
// report joins the same order (or account) as one more event of its history.

import { and, eq, like } from "drizzle-orm"
import type { FastifyBaseLogger, FastifyPluginAsync } from "fastify"
import { z } from "zod"
import { recordAuditEvent } from "./audit/record.js"
import { db } from "./db/client.js"
import { auditLogs } from "./db/schema.js"
import { env } from "./env.js"
import { validationError } from "./http.js"
import { matchesSecret } from "./net/shared-secret.js"

/** The reports worth an admin's eye. Passing ones (soft bounce, deferred) and engagement are left out. */
const TRACKED_EVENTS: Record<string, "success" | "failure"> = {
  delivered: "success",
  hard_bounce: "failure",
  blocked: "failure",
  spam: "failure",
  invalid_email: "failure",
  error: "failure",
}

// Brevo's free-text `reason` is never read: it quotes the address and the remote server.
const reportSchema = z.object({ event: z.string().min(1).max(50), "message-id": z.string().min(1).max(255) })
const payloadSchema = z.union([reportSchema, z.array(reportSchema).min(1).max(100)])

type Report = z.infer<typeof reportSchema>

async function recordReport(report: Report, log: FastifyBaseLogger): Promise<void> {
  const result = TRACKED_EVENTS[report.event]
  if (!result) return
  const messageId = report["message-id"]

  const [sent] = await db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.messageId, messageId), like(auditLogs.action, "email.%.sent")))
    .limit(1)
  if (!sent) {
    log.warn({ event: report.event }, "Brevo report for an e-mail we did not journal — ignored")
    return
  }

  const type = sent.action.split(".")[1]
  const action = `email.${type}.${report.event}`
  // Brevo retries a report it thinks was lost: one line per message and event.
  const [known] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(and(eq(auditLogs.messageId, messageId), eq(auditLogs.action, action)))
    .limit(1)
  if (known) return

  await recordAuditEvent({
    userRole: "system",
    entityType: sent.entityType,
    entityId: sent.entityId,
    orderId: sent.orderId,
    action,
    result,
    error: result === "failure" ? `brevo.${report.event}` : null,
    messageId,
    newValue: sent.newValue,
  })
  log.info({ orderId: sent.orderId, event: report.event }, "Brevo report recorded")
}

// Mounted under /api/webhooks/brevo. No JWT: Brevo sends the shared token.
export const brevoWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/", async (request, reply) => {
    if (!env.BREVO_WEBHOOK_SECRET) {
      return reply.code(503).send({ error: "NotConfigured", message: "Brevo webhook is not configured" })
    }
    const header = request.headers.authorization
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null
    if (!matchesSecret(token, env.BREVO_WEBHOOK_SECRET)) {
      request.log.warn("Brevo webhook token rejected")
      return reply.code(401).send({ error: "Unauthorized", message: "Invalid webhook token" })
    }

    const parsed = payloadSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send(validationError(parsed.error.issues))
    }
    const reports = Array.isArray(parsed.data) ? parsed.data : [parsed.data]
    for (const report of reports) await recordReport(report, request.log)
    return reply.code(200).send({ received: true })
  })
}
