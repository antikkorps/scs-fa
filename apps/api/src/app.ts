import { MAX_ARTWORK_IMAGE_SIZE_BYTES } from "@armurier/shared"
import fastifyCors from "@fastify/cors"
import fastifyHelmet from "@fastify/helmet"
import fastifyJwt from "@fastify/jwt"
import fastifyMultipart from "@fastify/multipart"
import fastifyRateLimit from "@fastify/rate-limit"
import Fastify, { type FastifyInstance } from "fastify"
import { addressRoutes } from "./addresses/index.js"
import { adminAncientWeaponRoutes } from "./ancient-weapons/admin.js"
import { ancientWeaponRoutes } from "./ancient-weapons/index.js"
import { artistRoutes } from "./artists/index.js"
import { adminArtworkRoutes } from "./artworks/admin.js"
import { adminArtworkEditorialRoutes } from "./artworks/admin-editorial.js"
import { adminArtworkImageRoutes, artworkImageRoutes } from "./artworks/images.js"
import { artworkRoutes } from "./artworks/index.js"
import { adminArtworkPricingRoutes } from "./artworks/pricing.js"
import { authRoutes } from "./auth/index.js"
import { adminBlogRoutes } from "./blog/admin.js"
import { adminBlogImageRoutes, blogImageRoutes } from "./blog/images.js"
import { blogRoutes } from "./blog/index.js"
import { cartRoutes } from "./cart/index.js"
import { env } from "./env.js"
import { legalCategoryRoutes } from "./legal-categories/index.js"
import { adminLegalDocumentRoutes } from "./legal-documents/admin.js"
import { legalDocumentRoutes } from "./legal-documents/index.js"
import { startLegalDocSlaScheduler } from "./legal-documents/sla.js"
import { buildLoggerOptions, genReqId, setupErrorAlerting } from "./logging/index.js"
import { adminMediaRoutes, mediaRoutes } from "./media/index.js"
import { adminMetricsRoutes } from "./metrics/admin.js"
import { newsletterRoutes } from "./newsletter/index.js"
import { adminOrderRoutes } from "./orders/admin.js"
import { orderRoutes } from "./orders/index.js"
import { adminPaymentRoutes } from "./payments/admin.js"
import { paymentRoutes, stripeWebhookRoutes } from "./payments/index.js"
import { productCategoryRoutes } from "./product-categories/index.js"
import { adminProductRoutes } from "./products/admin.js"
import { productRoutes } from "./products/index.js"
import { searchRoutes } from "./search/index.js"
import { adminTagRoutes } from "./tags/admin.js"
import { tagRoutes } from "./tags/index.js"

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
    // Pin the algorithm on both sign and verify so a token can never be accepted
    // under an unexpected algorithm (defence-in-depth vs. alg-confusion).
    sign: { algorithm: "HS256", expiresIn: env.JWT_EXPIRES_IN },
    verify: { algorithms: ["HS256"] },
  })

  // App-wide ceiling = the largest upload any route legitimately accepts (Gun Art
  // originals are print-grade). It is a backstop, NOT the per-feature limit: each
  // upload route passes its own, tighter `limits` to `request.parts()` — legal
  // documents and blog images stay at 10 MB and have tests pinning that.
  await fastify.register(fastifyMultipart, {
    limits: { fileSize: MAX_ARTWORK_IMAGE_SIZE_BYTES, files: 1, fields: 10 },
  })

  fastify.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }))

  await fastify.register(authRoutes, { prefix: "/api/auth" })
  await fastify.register(productRoutes, { prefix: "/api/products" })
  await fastify.register(productCategoryRoutes, { prefix: "/api/product-categories" })
  await fastify.register(tagRoutes, { prefix: "/api/tags" })
  await fastify.register(ancientWeaponRoutes, { prefix: "/api/ancient-weapons" })
  await fastify.register(artworkRoutes, { prefix: "/api/artworks" })
  await fastify.register(artworkImageRoutes, { prefix: "/api/artworks/images" })
  await fastify.register(artistRoutes, { prefix: "/api/artists" })
  await fastify.register(mediaRoutes, { prefix: "/api/media" })
  await fastify.register(blogRoutes, { prefix: "/api/blog" })
  await fastify.register(blogImageRoutes, { prefix: "/api/blog/images" })
  await fastify.register(newsletterRoutes, { prefix: "/api/newsletter" })
  await fastify.register(searchRoutes, { prefix: "/api/search" })
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
  await fastify.register(adminBlogRoutes, { prefix: "/api/admin/blog" })
  await fastify.register(adminBlogImageRoutes, { prefix: "/api/admin/blog/images" })
  await fastify.register(adminMetricsRoutes, { prefix: "/api/admin/metrics" })
  await fastify.register(adminAncientWeaponRoutes, { prefix: "/api/admin/ancient-weapons" })
  await fastify.register(adminArtworkImageRoutes, { prefix: "/api/admin/artworks" })
  await fastify.register(adminArtworkPricingRoutes, { prefix: "/api/admin/artworks" })
  await fastify.register(adminArtworkRoutes, { prefix: "/api/admin/artworks" })
  await fastify.register(adminArtworkEditorialRoutes, { prefix: "/api/admin/gun-art" })
  await fastify.register(adminProductRoutes, { prefix: "/api/admin/products" })
  await fastify.register(adminTagRoutes, { prefix: "/api/admin/tags" })
  await fastify.register(adminMediaRoutes, { prefix: "/api/admin/media" })

  // SLA 4.4: in-process breach alerting (no-op under tests / when interval is 0)
  startLegalDocSlaScheduler(fastify)

  return fastify
}
