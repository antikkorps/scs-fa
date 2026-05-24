import { buildApp } from "./app.js"
import { env } from "./env.js"

const fastify = await buildApp()

try {
  await fastify.listen({ host: env.API_HOST, port: env.API_PORT })
  fastify.log.info(`Server listening on http://${env.API_HOST}:${env.API_PORT}`)
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
