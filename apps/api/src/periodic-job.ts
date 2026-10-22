import type { FastifyInstance } from "fastify"
import { env } from "./env.js"

/**
 * Run a job at startup, then every `everyMs`. The job returns what it did, by
 * kind; a line is logged only when something happened. No-op under tests
 * (suites call the job directly). Cleared on server close.
 */
export function startPeriodicJob(
  app: FastifyInstance,
  name: string,
  everyMs: number,
  job: () => Promise<Record<string, number>>,
): void {
  if (env.NODE_ENV === "test") return

  const run = () =>
    job()
      .then((done) => {
        if (Object.values(done).some((count) => count > 0)) app.log.info(done, name)
      })
      .catch((err) => app.log.error({ err }, `${name} failed`))

  void run()
  const timer = setInterval(run, everyMs)
  timer.unref?.()
  app.addHook("onClose", async () => clearInterval(timer))
  app.log.info(`${name} scheduler started`)
}
