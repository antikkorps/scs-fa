import Stripe from "stripe"
import { env } from "../env.js"

// Thin wrapper around the Stripe SDK. Keeping every network call behind these
// functions lets the service/webhook code import them and tests mock this
// module wholesale (no real Stripe traffic, no API keys needed).

let _client: Stripe | null = null

function client(): Stripe {
  if (!_client) {
    _client = new Stripe(env.STRIPE_SECRET_KEY)
  }
  return _client
}

/** `options.idempotencyKey`: Stripe answers a repeated key with the same intent (story 12.9g). */
export function createPaymentIntent(
  params: Stripe.PaymentIntentCreateParams,
  options?: Stripe.RequestOptions,
): Promise<Stripe.PaymentIntent> {
  return client().paymentIntents.create(params, options)
}

export function retrievePaymentIntent(id: string): Promise<Stripe.PaymentIntent> {
  return client().paymentIntents.retrieve(id)
}

/** Cancel a PaymentIntent nobody paid, so it can no longer be confirmed. Stripe refuses once it has succeeded. */
export function cancelPaymentIntent(id: string): Promise<Stripe.PaymentIntent> {
  return client().paymentIntents.cancel(id)
}

export function retrieveCharge(id: string): Promise<Stripe.Charge> {
  return client().charges.retrieve(id)
}

/** Issue a refund against a PaymentIntent (full when `amount` is omitted, else partial, in cents). */
export function createRefund(
  params: Stripe.RefundCreateParams,
  options?: Stripe.RequestOptions,
): Promise<Stripe.Refund> {
  return client().refunds.create(params, options)
}

/** Verify a webhook payload's signature and return the parsed event. Throws on a bad signature. */
export function constructWebhookEvent(payload: Buffer, signature: string): Stripe.Event {
  return client().webhooks.constructEvent(payload, signature, env.STRIPE_WEBHOOK_SECRET)
}
