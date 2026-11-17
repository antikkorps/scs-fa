import { env } from "../env.js"
import { MailjetNewsletterService } from "./mailjet.js"
import { InMemoryNewsletterService } from "./memory.js"
import type { NewsletterService } from "./types.js"

function resolveDriver(): "mailjet" | "memory" {
  if (env.NEWSLETTER_DRIVER) return env.NEWSLETTER_DRIVER
  // Production mails for real; everywhere else (tests, CI, a laptop with no API
  // key) defaults to the in-process driver rather than failing at boot.
  return env.NODE_ENV === "production" ? "mailjet" : "memory"
}

function createNewsletterService(): NewsletterService {
  if (resolveDriver() === "memory") return new InMemoryNewsletterService()
  return new MailjetNewsletterService({
    apiKey: env.MAILJET_API_KEY,
    secretKey: env.MAILJET_SECRET_KEY,
    listIds: {
      armurerie: env.NEWSLETTER_LIST_ID_ARMURERIE,
      collection: env.NEWSLETTER_LIST_ID_COLLECTION,
      gun_art: env.NEWSLETTER_LIST_ID_GUN_ART,
    },
  })
}

// App-wide singleton. Driver is chosen once at startup from env.
export const newsletterProvider: NewsletterService = createNewsletterService()
