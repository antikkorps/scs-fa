import { NEWSLETTER_SEGMENTS, type NewsletterSegment } from "@armurier/shared"
import { env } from "../env.js"
import type { NewsletterService, SyncContactParams } from "./types.js"

const BREVO_API_BASE = "https://api.brevo.com/v3"
const REQUEST_TIMEOUT_MS = 10_000

/**
 * Brevo driver, spoken over plain `fetch` on the REST API v3 — four endpoints do
 * not justify a dependency to quarantine and upgrade forever.
 *
 * Segments map onto Brevo lists through env alone, so a segment can be pointed at
 * another list without a deploy of code. Double opt-in is **ours**, not Brevo's:
 * a contact only ever reaches this driver once its consent is confirmed and
 * timestamped in our own database.
 */
export class BrevoNewsletterService implements NewsletterService {
  private readonly apiKey: string
  private readonly listIds: Record<NewsletterSegment, number>

  constructor() {
    // Fail at startup, not on the first visitor who subscribes: a production
    // deploy missing its list ids must not silently drop consented addresses.
    if (!env.BREVO_API_KEY) throw new Error("BREVO_API_KEY is required when the newsletter driver is 'brevo'")
    const listIds = {
      armurerie: env.BREVO_LIST_ID_ARMURERIE,
      collection: env.BREVO_LIST_ID_COLLECTION,
      gun_art: env.BREVO_LIST_ID_GUN_ART,
    }
    for (const segment of NEWSLETTER_SEGMENTS) {
      if (!listIds[segment]) throw new Error(`Missing Brevo list id for newsletter segment "${segment}"`)
    }
    this.apiKey = env.BREVO_API_KEY
    this.listIds = listIds as Record<NewsletterSegment, number>
  }

  async syncContact(params: SyncContactParams): Promise<void> {
    const wanted = new Set(params.segments)
    const listIdsToAdd = params.segments.map((segment) => this.listIds[segment])
    const listIdsToRemove = NEWSLETTER_SEGMENTS.filter((segment) => !wanted.has(segment)).map(
      (segment) => this.listIds[segment],
    )

    // `updateEnabled` makes this an upsert: the same call creates the contact or
    // re-lists an existing one, so a re-subscription needs no lookup first.
    await this.request("POST", "/contacts", {
      email: params.email,
      listIds: listIdsToAdd,
      unlinkListIds: listIdsToRemove,
      updateEnabled: true,
    })
  }

  async deleteContact(email: string): Promise<void> {
    // Already-gone is a success: erasure is idempotent by definition.
    await this.request("DELETE", `/contacts/${encodeURIComponent(email)}`, undefined, [404])
  }

  private async request(method: string, path: string, body?: unknown, tolerateStatuses: number[] = []): Promise<void> {
    const response = await fetch(`${BREVO_API_BASE}${path}`, {
      method,
      headers: {
        "api-key": this.apiKey,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (response.ok || tolerateStatuses.includes(response.status)) return

    // The body can carry the subscriber's address; keep it out of the message so
    // it never lands in a log line. The status + code are enough to diagnose.
    const detail = await response
      .json()
      .then((payload: unknown) => (payload as { code?: string }).code ?? "")
      .catch(() => "")
    throw new Error(`Brevo ${method} ${path} failed with ${response.status}${detail ? ` (${detail})` : ""}`)
  }
}
