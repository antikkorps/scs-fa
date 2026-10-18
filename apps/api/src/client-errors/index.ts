// Story 12.7d — errors seen in the visitor's browser on the cart, checkout and
// payment pages, which the server would otherwise never hear of (a script that
// crashes, an API that cannot be reached, Stripe.js that does not load). They
// go to the technical logs (journald, 14 days) with this request's reqId.

import type { FastifyPluginAsync } from "fastify"
import { z } from "zod"
import { validationError } from "../http.js"
import { createWindowLimiter } from "../net/window-limiter.js"

export const CLIENT_ERRORS_PER_MINUTE = 10

/** The pages watched: the cart, the checkout and an order's payment. */
const TRACKED_PATH = /^\/(panier|commande)(\/[^?#]*)?([?#].*)?$/

const reportSchema = z
  .object({
    kind: z.enum(["error", "unhandledrejection", "vue", "network", "stripe"]),
    message: z.string().min(1).max(500),
    path: z.string().max(200).regex(TRACKED_PATH),
    stack: z.string().max(4000).optional(),
    code: z.string().max(100).optional(),
    relatedReqId: z.string().max(200).optional(),
  })
  .strict()

export type ClientErrorReport = z.infer<typeof reportSchema>

const SCRUBBED = [
  /[^\s@()<>"'`,;]+@[^\s@()<>"'`,;]+\.[a-z]{2,}/gi, // e-mail addresses
  /\b\d{4}(?:[ -]\d{4}){2,3}\b/g, // card numbers written in groups
  /\d{8,}/g, // long digit runs: a card number, a phone number
]

function scrub(text: string): string {
  return SCRUBBED.reduce((cleaned, pattern) => cleaned.replace(pattern, "[redacted]"), text)
}

/**
 * The log line for a report. The front never sends form values; this is the
 * second line of defence for what a message may still quote.
 */
export function toLogEntry(report: ClientErrorReport, userAgent: string | undefined) {
  return {
    kind: report.kind,
    message: scrub(report.message),
    path: report.path.replace(/[?#].*$/, ""),
    stack: report.stack === undefined ? undefined : scrub(report.stack),
    code: report.code,
    relatedReqId: report.relatedReqId,
    userAgent: userAgent?.slice(0, 200),
  }
}

// Mounted under /api/client-errors. Public: the visitor may not be signed in.
export const clientErrorRoutes: FastifyPluginAsync = async (fastify) => {
  const limiter = createWindowLimiter({ max: CLIENT_ERRORS_PER_MINUTE, windowMs: 60_000 })

  fastify.post("/", { bodyLimit: 8 * 1024 }, async (request, reply) => {
    if (!limiter.hit(request.ip)) {
      return reply.code(429).send({ error: "TooManyRequests", message: "Too many error reports" })
    }
    const parsed = reportSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send(validationError(parsed.error.issues))
    }
    request.log.warn({ clientError: toLogEntry(parsed.data, request.headers["user-agent"]) }, "Browser error")
    return reply.code(204).send()
  })
}
