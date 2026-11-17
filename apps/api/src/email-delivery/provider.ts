import { env } from "../env.js"
import { mailjetDelivery } from "./mailjet.js"
import type { DeliveryProvider } from "./types.js"

const PROVIDERS: Record<NonNullable<typeof env.EMAIL_PROVIDER>, DeliveryProvider> = {
  mailjet: mailjetDelivery,
}

/**
 * The provider behind SMTP_HOST, chosen once from env. Unset (a laptop on
 * Mailpit): no tracking header is added and the webhook answers 503.
 */
export const deliveryProvider: DeliveryProvider | null = env.EMAIL_PROVIDER ? PROVIDERS[env.EMAIL_PROVIDER] : null
