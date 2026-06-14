import { randomUUID } from "node:crypto"
import type { FastifyRequest } from "fastify"
import type { PinoLoggerOptions } from "fastify/types/logger.js"
import type { Env } from "../env.js"

// Fields that must never reach the logs. Pino redacts these paths on every
// record (request/response serializers and any object we log by hand), so a
// bearer token, cookie, webhook signature or password can't leak into a log
// sink. The censor keeps the key present (useful to see *that* a header was
// sent) while hiding the value.
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["stripe-signature"]',
  'res.headers["set-cookie"]',
  // Defensive: if any handler logs a body/object carrying these, hide them too.
  "*.password",
  "*.passwordHash",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
] as const

/** Log level for an environment: quiet tests, info in prod, debug locally, with an explicit override. */
export function resolveLogLevel(env: Env): string {
  if (env.LOG_LEVEL) return env.LOG_LEVEL
  if (env.NODE_ENV === "test") return "silent"
  if (env.NODE_ENV === "production") return "info"
  return "debug"
}

/**
 * Build the Pino options for the API logger.
 *
 * Structured JSON in production (one line per record, ready for shipping to a
 * log aggregator), pretty-printed locally, silent under tests. Sensitive header
 * and credential paths are redacted, and every record carries the service name
 * and environment so logs from multiple deployments stay distinguishable.
 */
export function buildLoggerOptions(env: Env): PinoLoggerOptions {
  return {
    level: resolveLogLevel(env),
    redact: { paths: [...REDACT_PATHS], censor: "[redacted]" },
    base: { service: "scs-api", env: env.NODE_ENV },
    transport:
      env.NODE_ENV === "development"
        ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } }
        : undefined,
  }
}

/**
 * Request id generator: honour an inbound `x-request-id` (so a trace started at
 * the proxy / front carries through our logs) and otherwise mint a UUID. Capped
 * in length to keep a hostile header from bloating every log line.
 */
export function genReqId(req: FastifyRequest["raw"]): string {
  const header = req.headers["x-request-id"]
  const incoming = Array.isArray(header) ? header[0] : header
  if (incoming && incoming.length > 0) return incoming.slice(0, 200)
  return randomUUID()
}
