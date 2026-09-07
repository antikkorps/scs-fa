import { env } from "../env.js"
import { BrevoNewsletterService } from "./brevo.js"
import { InMemoryNewsletterService } from "./memory.js"
import type { NewsletterService } from "./types.js"

function resolveDriver(): "brevo" | "memory" {
  if (env.NEWSLETTER_DRIVER) return env.NEWSLETTER_DRIVER
  // Production mails for real; everywhere else (tests, CI, a laptop with no API
  // key) defaults to the in-process driver rather than failing at boot.
  return env.NODE_ENV === "production" ? "brevo" : "memory"
}

function createNewsletterService(): NewsletterService {
  return resolveDriver() === "brevo" ? new BrevoNewsletterService() : new InMemoryNewsletterService()
}

// App-wide singleton. Driver is chosen once at startup from env.
export const newsletterProvider: NewsletterService = createNewsletterService()
