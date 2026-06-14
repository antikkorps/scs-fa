import { eq } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { db } from "../db/client.js"
import { users } from "../db/schema.js"
import { sendErrorAlertEmail } from "../email.js"
import type { Env } from "../env.js"
import { createAlerter } from "./alerting.js"
import { buildErrorHandler } from "./error-handler.js"

export { buildLoggerOptions, genReqId } from "./logger.js"

/**
 * Wire the centralised error handler and its throttled admin-email alerter.
 *
 * Alerts only reach SMTP when enabled (on by default in production, off
 * elsewhere unless `ERROR_ALERTS_ENABLED=true`) so dev and test never send mail.
 * Delivery is best-effort and the admin lookup happens lazily per alert, so a
 * fresh admin account starts receiving alerts without a restart.
 */
export function setupErrorAlerting(fastify: FastifyInstance, env: Env): void {
  const alertsEnabled = env.ERROR_ALERTS_ENABLED ?? env.NODE_ENV === "production"

  const alerter = createAlerter({
    cooldownMs: env.ERROR_ALERT_COOLDOWN_MINUTES * 60_000,
    onError: (err) => fastify.log.error({ err }, "error alert delivery failed"),
    sendAlert: async (ctx) => {
      if (!alertsEnabled) return
      const admins = await db.select({ email: users.email }).from(users).where(eq(users.role, "admin"))
      if (admins.length === 0) return
      await sendErrorAlertEmail(
        admins.map((a) => a.email),
        ctx,
      )
    },
  })

  fastify.setErrorHandler(buildErrorHandler({ isProduction: env.NODE_ENV === "production", alerter }))
}
