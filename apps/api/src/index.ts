import { buildApp } from "./app.js"
import { pool } from "./db/client.js"
import { databaseRoleProblems } from "./db/role-guard.js"
import { env } from "./env.js"
import { bankDetailsFrom } from "./payments/bank-details.js"

// Story 12.9f — production runs as the least-privilege `scs_app` role, never stronger.
if (env.NODE_ENV === "production") {
  const problems = await databaseRoleProblems(pool)
  if (problems.length > 0) {
    throw new Error(
      `Production refuses to run with this DATABASE_URL role (${problems.join("; ")}). Connect as scs_app: docs/DEPLOY.md § Database roles`,
    )
  }
}

const fastify = await buildApp()

try {
  await fastify.listen({ host: env.API_HOST, port: env.API_PORT })
  fastify.log.info(`Server listening on http://${env.API_HOST}:${env.API_PORT}`)
  // Optional at boot, but every regulated-firearm order is refused without it.
  if (!bankDetailsFrom(env)) {
    fastify.log.warn("No VIREMENT_* bank details: orders that need a bank transfer are refused until they are set")
  }
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
