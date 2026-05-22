import fastifyCors from "@fastify/cors"
import fastifyHelmet from "@fastify/helmet"
import fastifyJwt from "@fastify/jwt"
import fastifyRateLimit from "@fastify/rate-limit"
import Fastify from "fastify"
import { env } from "./env.js"

const fastify = Fastify({
  logger: {
    level: env.NODE_ENV === "production" ? "info" : "debug",
    transport:
      env.NODE_ENV === "production"
        ? undefined
        : {
            target: "pino-pretty",
            options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" },
          },
  },
  trustProxy: env.NODE_ENV === "production",
})

await fastify.register(fastifyHelmet, {
  contentSecurityPolicy: env.NODE_ENV === "production" ? undefined : false,
})

await fastify.register(fastifyRateLimit, {
  max: 100,
  timeWindow: "1 minute",
})

await fastify.register(fastifyCors, {
  origin: env.NODE_ENV === "production" ? "https://armurier.fr" : "http://localhost:3000",
  credentials: true,
})

await fastify.register(fastifyJwt, {
  secret: env.JWT_SECRET,
  sign: { expiresIn: env.JWT_EXPIRES_IN },
})

fastify.get("/health", async () => ({
  status: "ok",
  timestamp: new Date().toISOString(),
}))

// TODO: register routes
// await fastify.register(authRoutes, { prefix: "/api/auth" })
// await fastify.register(productRoutes, { prefix: "/api/products" })

try {
  await fastify.listen({ host: env.API_HOST, port: env.API_PORT })
  fastify.log.info(`Server listening on http://${env.API_HOST}:${env.API_PORT}`)
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
