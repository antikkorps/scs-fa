import { adminMetricsQuerySchema } from "@armurier/shared"
import type { FastifyPluginAsync } from "fastify"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import { env } from "../env.js"
import { validationError } from "../http.js"
import { computeMetrics } from "./service.js"

const DEFAULT_WINDOW_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

// Admin business-metrics API. Mounted under /api/admin/metrics.
export const adminMetricsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  // GET /api/admin/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD — defaults to the last 30 days
  fastify.get("/", async (request, reply) => {
    const parsed = adminMetricsQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send(validationError(parsed.error.issues))
    }

    const now = new Date()
    // `to` is exclusive and end-of-day inclusive: bump the parsed day by one.
    const to = parsed.data.to ? new Date(`${parsed.data.to}T00:00:00.000Z`).getTime() + DAY_MS : now.getTime()
    const from = parsed.data.from
      ? new Date(`${parsed.data.from}T00:00:00.000Z`).getTime()
      : to - DEFAULT_WINDOW_DAYS * DAY_MS

    const metrics = await computeMetrics({
      from: new Date(from),
      to: new Date(to),
      commissionRatePct: env.COMMISSION_RATE_PCT,
      now,
    })

    return reply.code(200).send({ data: metrics })
  })
}
