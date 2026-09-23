import type { FastifyReply, FastifyRequest } from "fastify"
import { ObjectNotFoundError } from "./types.js"

/**
 * Turn a failed storage read into the right HTTP answer.
 *
 * Every route that serves stored bytes used to `catch {}` and return 404, which
 * is wrong twice over:
 *
 *  - It tells clients, caches and crawlers that the image is permanently gone
 *    while the store is merely unreachable. An expired key or a provider outage
 *    would quietly de-index every visual on the site.
 *  - It discards the cause. A dev pointing at S3 with placeholder credentials
 *    got "Image not found" and no log line — the reason took a probe to find.
 *
 * A genuine miss stays a 404. Anything else is logged with its cause and
 * answered 502: the failure is upstream of us, and 502 is not cached as final.
 */
export function replyForStorageReadFailure(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
  key: string,
  notFoundMessage: string,
): FastifyReply {
  if (error instanceof ObjectNotFoundError) {
    return reply.code(404).send({ error: "NotFound", message: notFoundMessage })
  }
  request.log.error({ err: error, key }, "storage read failed")
  return reply.code(502).send({ error: "BadGateway", message: "Storage temporarily unavailable" })
}
