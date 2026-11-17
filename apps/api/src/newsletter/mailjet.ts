import { NEWSLETTER_SEGMENTS, type NewsletterSegment } from "@armurier/shared"
import type { NewsletterService, SyncContactParams } from "./types.js"

const MAILJET_API_BASE = "https://api.mailjet.com"
const REQUEST_TIMEOUT_MS = 10_000

export interface MailjetNewsletterConfig {
  apiKey: string | undefined
  secretKey: string | undefined
  listIds: Record<NewsletterSegment, number | undefined>
}

/**
 * Mailjet driver, spoken over plain `fetch` on the REST API — three endpoints do
 * not justify a dependency to quarantine and upgrade forever.
 *
 * Segments map onto Mailjet lists through env alone. Double opt-in is **ours**:
 * a contact only ever reaches this driver once its consent is confirmed and
 * timestamped in our own database.
 */
export class MailjetNewsletterService implements NewsletterService {
  private readonly authorization: string
  private readonly listIds: Record<NewsletterSegment, number>

  constructor(config: MailjetNewsletterConfig) {
    // Fail at startup, not on the first visitor who subscribes: a production
    // deploy missing its list ids must not silently drop consented addresses.
    if (!config.apiKey) throw new Error("MAILJET_API_KEY is required when the newsletter driver is 'mailjet'")
    if (!config.secretKey) throw new Error("MAILJET_SECRET_KEY is required when the newsletter driver is 'mailjet'")
    for (const segment of NEWSLETTER_SEGMENTS) {
      if (!config.listIds[segment]) throw new Error(`Missing newsletter list id for segment "${segment}"`)
    }
    this.authorization = `Basic ${Buffer.from(`${config.apiKey}:${config.secretKey}`).toString("base64")}`
    this.listIds = config.listIds as Record<NewsletterSegment, number>
  }

  async syncContact({ email, segments }: SyncContactParams): Promise<void> {
    const wanted = new Set(segments)
    // `managecontact` creates the contact when needed, so every call is an upsert.
    // `addforce` re-subscribes someone who left a list and confirmed again with us;
    // `unsub` keeps the withdrawal on the list rather than relying on its absence.
    for (const segment of NEWSLETTER_SEGMENTS) {
      await this.request("POST", `/v3/REST/contactslist/${this.listIds[segment]}/managecontact`, {
        Email: email,
        Action: wanted.has(segment) ? "addforce" : "unsub",
      })
    }
  }

  async deleteContact(email: string): Promise<void> {
    // The GDPR deletion takes Mailjet's numeric id; unknown is already gone.
    const found = await this.request("GET", `/v3/REST/contact/${encodeURIComponent(email)}`, undefined, [404])
    if (!found) return
    const id = await contactIdOf(found)
    if (!id) return
    await this.request("DELETE", `/v4/contacts/${id}`, undefined, [404])
  }

  /** The response (null when its status is tolerated), or an error without the response's text. */
  private async request(
    method: string,
    path: string,
    body?: unknown,
    tolerate: number[] = [],
  ): Promise<Response | null> {
    const response = await fetch(`${MAILJET_API_BASE}${path}`, {
      method,
      headers: {
        authorization: this.authorization,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (tolerate.includes(response.status)) return null
    if (!response.ok) {
      // Neither the body nor a lookup path may reach a log line: both can hold the address.
      const where = path.replace(/contact\/[^/]+$/, "contact/…")
      throw new Error(`Mailjet ${method} ${where} failed with ${response.status}`)
    }
    return response
  }
}

/**
 * Mailjet's numeric id from a contact lookup. Only this body is ever read: the
 * others echo the address, and a parse error would quote it into a log line.
 */
async function contactIdOf(response: Response): Promise<number | undefined> {
  const payload: unknown = await response.json().catch(() => {
    throw new Error("Mailjet contact lookup returned an unreadable body")
  })
  return (payload as { Data?: { ID?: number }[] })?.Data?.[0]?.ID
}
