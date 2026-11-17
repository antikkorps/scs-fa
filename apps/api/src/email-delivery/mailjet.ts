import { z } from "zod"
import type { DeliveryOutcome, DeliveryProvider, DeliveryReport } from "./types.js"

// Mailjet's Event API, registered for the events `sent`, `bounce`, `blocked` and
// `spam` (docs/DEPLOY.md). Only the event name, our id and the bounce kind are
// read: the free-text `error` and `email` fields quote the address.
const eventSchema = z.object({
  event: z.string().min(1).max(50),
  CustomID: z.string().max(255).optional(),
  hard_bounce: z.boolean().optional(),
})
const MAX_GROUPED_EVENTS = 1000

type MailjetEvent = z.infer<typeof eventSchema>

/** Mailjet's event, in our vocabulary; null for those we leave out (soft bounce, open, click, unsub). */
function outcomeOf(event: MailjetEvent): DeliveryOutcome | null {
  switch (event.event) {
    // "sent" is Mailjet's last word: the recipient's server accepted the e-mail.
    case "sent":
      return "delivered"
    case "bounce":
      return event.hard_bounce ? "hard_bounce" : null
    case "blocked":
      return "blocked"
    case "spam":
      return "spam"
    default:
      return null
  }
}

function toReport(event: MailjetEvent): DeliveryReport | null {
  const outcome = outcomeOf(event)
  // No CustomID: not one of our e-mails (a letter sent from Mailjet's campaign editor).
  if (!outcome || !event.CustomID) return null
  return { trackingId: event.CustomID, outcome }
}

/** The password of `Authorization: Basic …`, the only credential Mailjet can send. */
function basicPassword(authorization: string | undefined): string | null {
  const match = authorization?.match(/^Basic ([A-Za-z0-9+/]+=*)$/)
  if (!match) return null
  const credentials = Buffer.from(match[1], "base64").toString("utf8")
  const separator = credentials.indexOf(":")
  const password = separator === -1 ? "" : credentials.slice(separator + 1)
  return password || null
}

export const mailjetDelivery: DeliveryProvider = {
  trackingHeaders: (trackingId) => ({ "X-MJ-CustomID": trackingId }),

  // The webhook URL carries the secret as `https://mailjet:<secret>@…`.
  presentedSecret: basicPassword,

  // One event per call, or an array when Mailjet groups them (at most once a second).
  // In a group, a malformed event is dropped alone: refusing the whole batch would
  // make Mailjet retry it for 24 h and the good reports would never be recorded.
  parseReports(body) {
    if (Array.isArray(body)) {
      if (body.length === 0 || body.length > MAX_GROUPED_EVENTS) return null
      return body.flatMap((item) => {
        const parsed = eventSchema.safeParse(item)
        const report = parsed.success ? toReport(parsed.data) : null
        return report ? [report] : []
      })
    }
    const parsed = eventSchema.safeParse(body)
    if (!parsed.success) return null
    const report = toReport(parsed.data)
    return report ? [report] : []
  },
}
