import fastifyCors from "@fastify/cors"
import fastifyHelmet from "@fastify/helmet"
import fastifyJwt from "@fastify/jwt"
import fastifyRateLimit from "@fastify/rate-limit"
import Fastify, { type FastifyInstance } from "fastify"
import { authRoutes } from "./auth/index.js"
import { env } from "./env.js"

export async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : env.NODE_ENV === "test" ? "silent" : "debug",
      transport:
        env.NODE_ENV === "development"
          ? {
              target: "pino-pretty",
              options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" },
            }
          : undefined,
    },
    trustProxy: env.NODE_ENV === "production",
  })

  await fastify.register(fastifyHelmet, {
    contentSecurityPolicy: env.NODE_ENV === "production" ? undefined : false,
  })

  if (env.NODE_ENV !== "test") {
    await fastify.register(fastifyRateLimit, {
      max: 100,
      timeWindow: "1 minute",
    })
  }

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

  await fastify.register(authRoutes, { prefix: "/api/auth" })

  return fastify
}
