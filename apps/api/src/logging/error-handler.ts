import type { FastifyError, FastifyReply, FastifyRequest } from "fastify"
import type { Alerter } from "./alerting.js"

export interface ErrorHandlerDeps {
  isProduction: boolean
  alerter: Alerter
}

// Statuses below this are the client's fault (bad input, auth, rate limit) and
// are answered without alerting; at or above it, it's our bug and we alert.
const SERVER_ERROR = 500

/**
 * Centralised Fastify error handler.
 *
 * Most routes return shaped error responses themselves; this catches what slips
 * through — an unhandled throw (a DB outage, a programming bug) or a
 * framework-raised error. Client errors (4xx) are echoed back with their status;
 * server errors (5xx) are logged with the request id and trigger a throttled
 * admin alert, while the client only ever gets a generic message in production
 * so internals (stack, SQL, paths) never leak.
 */
export function buildErrorHandler(deps: ErrorHandlerDeps) {
  return function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
    const statusCode = typeof error.statusCode === "number" && error.statusCode >= 400 ? error.statusCode : SERVER_ERROR
    const isServerError = statusCode >= SERVER_ERROR

    // Always log; server errors at error level with the stack, client errors at warn.
    const logPayload = { err: error, reqId: request.id, statusCode, method: request.method, url: request.url }
    if (isServerError) request.log.error(logPayload, error.message)
    else request.log.warn(logPayload, error.message)

    if (isServerError) {
      // Group by route + error type so a hot bug alerts once per cooldown.
      const route = request.routeOptions?.url ?? request.url
      void deps.alerter.alert({
        signature: `${request.method} ${route} ${error.name || "Error"}`,
        statusCode,
        method: request.method,
        url: request.url,
        reqId: String(request.id),
        message: error.message,
        stack: error.stack,
      })
    }

    const body = isServerError
      ? { error: "InternalServerError", message: deps.isProduction ? "An unexpected error occurred" : error.message }
      : { error: error.code || error.name || "Error", message: error.message }

    return reply.code(statusCode).send(body)
  }
}
