import type { FastifyInstance } from "fastify"
import { startPeriodicJob } from "./periodic-job.js"

const PURGE_EVERY_MS = 24 * 60 * 60 * 1000

/**
 * Run a retention purge at startup, then once a day. The purge returns what it
 * removed, by kind; a line is logged only when something went.
 */
export function startDailyPurge(
  app: FastifyInstance,
  name: string,
  purge: () => Promise<Record<string, number>>,
): void {
  startPeriodicJob(app, `${name} purge`, PURGE_EVERY_MS, purge)
}
