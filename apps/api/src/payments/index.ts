import { claimVirementSchema, createStripePaymentSchema, uuidParamSchema } from "@armurier/shared"
import type { FastifyPluginAsync } from "fastify"
import type Stripe from "stripe"
import { authenticate } from "../auth/authenticate.js"
import { validationError } from "../http.js"
import {
  claimVirementTransfer,
  getVirementInstructions,
  handleStripeEvent,
  initStripePayment,
  PaymentError,
} from "./service.js"
import { constructWebhookEvent } from "./stripe.js"

// Authenticated card-payment routes. Mounted under /api/payments.
export const paymentRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)

  // POST /api/payments/stripe/intent — create/reuse a PaymentIntent for an order
  fastify.post("/stripe/intent", async (request, reply) => {
    const parsed = createStripePaymentSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send(validationError(parsed.error.issues))
    }

    try {
      const result = await initStripePayment(parsed.data.orderId, request.user.sub)
      return reply.code(201).send({ data: result })
    } catch (err) {
      if (err instanceof PaymentError) {
        return reply.code(err.statusCode).send({ error: err.errorCode, message: err.message })
      }
      throw err
    }
  })

  // GET /api/payments/virement/:id — bank-transfer (RIB) instructions for an order
  fastify.get("/virement/:id", async (request, reply) => {
    const parsed = uuidParamSchema.safeParse(request.params)
    if (!parsed.success) {
      return reply.code(400).send(validationError(parsed.error.issues))
    }

    try {
      const result = await getVirementInstructions(parsed.data.id, request.user.sub)
      return reply.code(200).send({ data: result })
    } catch (err) {
      if (err instanceof PaymentError) {
        return reply.code(err.statusCode).send({ error: err.errorCode, message: err.message })
      }
      throw err
    }
  })

  // POST /api/payments/virement/:id/claim — customer declares the transfer is sent
  fastify.post("/virement/:id/claim", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(validationError(params.error.issues))
    }
    const body = claimVirementSchema.safeParse(request.body ?? {})
    if (!body.success) {
      return reply.code(400).send(validationError(body.error.issues))
    }

    try {
      const result = await claimVirementTransfer(params.data.id, request.user.sub, body.data)
      return reply.code(200).send({ data: result })
    } catch (err) {
      if (err instanceof PaymentError) {
        return reply.code(err.statusCode).send({ error: err.errorCode, message: err.message })
      }
      throw err
    }
  })
}

// Stripe webhook receiver. Mounted under /api/webhooks/stripe. No JWT: Stripe
// authenticates via the signed payload, not a bearer token. The raw body is
// required to verify that signature, so this plugin parses application/json as
// a Buffer (encapsulated — it does not affect the rest of the API).
export const stripeWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => {
    done(null, body)
  })

  // POST /api/webhooks/stripe
  fastify.post("/", async (request, reply) => {
    const signature = request.headers["stripe-signature"]
    if (typeof signature !== "string") {
      return reply.code(400).send({ error: "BadRequest", message: "Missing stripe-signature header" })
    }

    let event: Stripe.Event
    try {
      event = constructWebhookEvent(request.body as Buffer, signature)
    } catch {
      return reply.code(400).send({ error: "InvalidSignature", message: "Webhook signature verification failed" })
    }

    await handleStripeEvent(event)
    return reply.code(200).send({ received: true })
  })
}
