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

export function createPaymentIntent(params: Stripe.PaymentIntentCreateParams): Promise<Stripe.PaymentIntent> {
  return client().paymentIntents.create(params)
}

export function retrievePaymentIntent(id: string): Promise<Stripe.PaymentIntent> {
  return client().paymentIntents.retrieve(id)
}

/** Verify a webhook payload's signature and return the parsed event. Throws on a bad signature. */
export function constructWebhookEvent(payload: Buffer, signature: string): Stripe.Event {
  return client().webhooks.constructEvent(payload, signature, env.STRIPE_WEBHOOK_SECRET)
}
