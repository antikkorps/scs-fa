import { MAX_LEGAL_DOC_SIZE_BYTES } from "@armurier/shared"
import fastifyCors from "@fastify/cors"
import fastifyHelmet from "@fastify/helmet"
import fastifyJwt from "@fastify/jwt"
import fastifyMultipart from "@fastify/multipart"
import fastifyRateLimit from "@fastify/rate-limit"
import Fastify, { type FastifyInstance } from "fastify"
import { addressRoutes } from "./addresses/index.js"
import { artworkRoutes } from "./artworks/index.js"
import { authRoutes } from "./auth/index.js"
import { cartRoutes } from "./cart/index.js"
import { env } from "./env.js"
import { legalCategoryRoutes } from "./legal-categories/index.js"
import { adminLegalDocumentRoutes } from "./legal-documents/admin.js"
import { legalDocumentRoutes } from "./legal-documents/index.js"
import { startLegalDocSlaScheduler } from "./legal-documents/sla.js"
import { buildLoggerOptions, genReqId, setupErrorAlerting } from "./logging/index.js"
import { adminMetricsRoutes } from "./metrics/admin.js"
import { adminOrderRoutes } from "./orders/admin.js"
import { orderRoutes } from "./orders/index.js"
import { adminPaymentRoutes } from "./payments/admin.js"
import { paymentRoutes, stripeWebhookRoutes } from "./payments/index.js"
import { productRoutes } from "./products/index.js"

export async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: buildLoggerOptions(env),
    genReqId: (req) => genReqId(req),
    trustProxy: env.NODE_ENV === "production",
  })

  // Centralised error handling + throttled admin alerting on 5xx (Story 7.2).
  setupErrorAlerting(fastify, env)

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
    origin: env.NODE_ENV === "production" ? env.WEB_BASE_URL : "http://localhost:3000",
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
  await fastify.register(artworkRoutes, { prefix: "/api/artworks" })
  await fastify.register(legalCategoryRoutes, { prefix: "/api/legal-categories" })
  await fastify.register(cartRoutes, { prefix: "/api/cart" })
  await fastify.register(addressRoutes, { prefix: "/api/addresses" })
  await fastify.register(orderRoutes, { prefix: "/api/orders" })
  await fastify.register(paymentRoutes, { prefix: "/api/payments" })
  await fastify.register(stripeWebhookRoutes, { prefix: "/api/webhooks/stripe" })
  await fastify.register(legalDocumentRoutes, { prefix: "/api/legal-documents" })
  await fastify.register(adminLegalDocumentRoutes, { prefix: "/api/admin/legal-documents" })
  await fastify.register(adminPaymentRoutes, { prefix: "/api/admin/payments" })
  await fastify.register(adminOrderRoutes, { prefix: "/api/admin/orders" })
  await fastify.register(adminMetricsRoutes, { prefix: "/api/admin/metrics" })

  // SLA 4.4: in-process breach alerting (no-op under tests / when interval is 0)
  startLegalDocSlaScheduler(fastify)

  return fastify
}
