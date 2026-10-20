import type { FastifyInstance } from "fastify"
import { env } from "./env.js"

const PURGE_EVERY_MS = 24 * 60 * 60 * 1000

/**
 * Run a retention purge at startup, then once a day. The purge returns what it
 * removed, by kind; a line is logged only when something went. No-op under
 * tests (suites call the purge directly). Cleared on server close.
 */
export function startDailyPurge(
  app: FastifyInstance,
  name: string,
  purge: () => Promise<Record<string, number>>,
): void {
  if (env.NODE_ENV === "test") return

  const run = () =>
    purge()
      .then((removed) => {
        if (Object.values(removed).some((count) => count > 0)) app.log.info(removed, `${name} purge`)
      })
      .catch((err) => app.log.error({ err }, `${name} purge failed`))

  void run()
  const timer = setInterval(run, PURGE_EVERY_MS)
  timer.unref?.()
  app.addHook("onClose", async () => clearInterval(timer))
  app.log.info(`${name} purge scheduler started`)
}
