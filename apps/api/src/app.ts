import { MAX_LEGAL_DOC_SIZE_BYTES } from "@armurier/shared"
import fastifyCors from "@fastify/cors"
import fastifyHelmet from "@fastify/helmet"
import fastifyJwt from "@fastify/jwt"
import fastifyMultipart from "@fastify/multipart"
import fastifyRateLimit from "@fastify/rate-limit"
import Fastify, { type FastifyInstance } from "fastify"
import { addressRoutes } from "./addresses/index.js"
import { authRoutes } from "./auth/index.js"
import { cartRoutes } from "./cart/index.js"
import { env } from "./env.js"
import { legalCategoryRoutes } from "./legal-categories/index.js"
import { adminLegalDocumentRoutes } from "./legal-documents/admin.js"
import { legalDocumentRoutes } from "./legal-documents/index.js"
import { startLegalDocSlaScheduler } from "./legal-documents/sla.js"
import { orderRoutes } from "./orders/index.js"
import { productRoutes } from "./products/index.js"

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

  await fastify.register(fastifyMultipart, {
    limits: { fileSize: MAX_LEGAL_DOC_SIZE_BYTES, files: 1, fields: 10 },
  })

  fastify.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }))

  await fastify.register(authRoutes, { prefix: "/api/auth" })
  await fastify.register(productRoutes, { prefix: "/api/products" })
  await fastify.register(legalCategoryRoutes, { prefix: "/api/legal-categories" })
  await fastify.register(cartRoutes, { prefix: "/api/cart" })
  await fastify.register(addressRoutes, { prefix: "/api/addresses" })
  await fastify.register(orderRoutes, { prefix: "/api/orders" })
  await fastify.register(legalDocumentRoutes, { prefix: "/api/legal-documents" })
  await fastify.register(adminLegalDocumentRoutes, { prefix: "/api/admin/legal-documents" })

  // SLA 4.4: in-process breach alerting (no-op under tests / when interval is 0)
  startLegalDocSlaScheduler(fastify)

  return fastify
}
