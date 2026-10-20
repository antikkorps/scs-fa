import { createHash } from "node:crypto"
import { eq, inArray } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db } from "../db/client.js"
import { newsletterContacts, newsletterSubscriptions, newsletterTokens } from "../db/schema.js"
import { purgeUnconfirmedNewsletterRequests } from "./retention.js"

const NOW = new Date("2026-10-20T03:00:00Z")
const hoursBefore = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000)

const address = (name: string) => `newsletter-retention-${name}@example.test`
const hashOf = (email: string) => createHash("sha256").update(email).digest("hex")
const NAMES = ["stale", "fresh", "subscriber", "returning", "tokens"] as const
const HASHES = NAMES.map((name) => hashOf(address(name)))

type Segment = "armurerie" | "collection" | "gun_art"
type Subscription = {
  segment: Segment
  status: "pending" | "confirmed" | "unsubscribed"
  requestedAt: Date
  unsubscribedAt?: Date
}

async function cleanup() {
  await db.delete(newsletterContacts).where(inArray(newsletterContacts.emailHash, HASHES))
}

async function contact(name: (typeof NAMES)[number], subscriptions: Subscription[]): Promise<string> {
  const email = address(name)
  const [row] = await db
    .insert(newsletterContacts)
    .values({ email, emailHash: hashOf(email) })
    .returning({ id: newsletterContacts.id })
  await db.insert(newsletterSubscriptions).values(subscriptions.map((sub) => ({ contactId: row.id, ...sub })))
  return row.id
}

async function token(contactId: string, purpose: "confirm" | "unsubscribe", expiresAt: Date | null) {
  await db
    .insert(newsletterTokens)
    .values({ contactId, purpose, expiresAt, tokenHash: hashOf(`${contactId}-${purpose}-${expiresAt?.getTime()}`) })
}

const contactById = async (id: string) =>
  (await db.select().from(newsletterContacts).where(eq(newsletterContacts.id, id)))[0] ?? null

const subscriptionsOf = async (id: string) =>
  (
    await db
      .select({ segment: newsletterSubscriptions.segment, status: newsletterSubscriptions.status })
      .from(newsletterSubscriptions)
      .where(eq(newsletterSubscriptions.contactId, id))
  ).sort((a, b) => a.segment.localeCompare(b.segment))

const tokensOf = async (id: string) =>
  db.select({ purpose: newsletterTokens.purpose }).from(newsletterTokens).where(eq(newsletterTokens.contactId, id))

describe("newsletter retention — unconfirmed sign-ups (bloc 1)", () => {
  beforeAll(cleanup)
  afterAll(cleanup)

  it("erases a sign-up never confirmed within the 72-hour link, address and tokens included", async () => {
    const id = await contact("stale", [{ segment: "armurerie", status: "pending", requestedAt: hoursBefore(73) }])
    await token(id, "confirm", hoursBefore(1))
    await token(id, "unsubscribe", null)

    await purgeUnconfirmedNewsletterRequests(NOW)

    expect(await contactById(id)).toBeNull()
    expect(await tokensOf(id)).toEqual([])
  })

  it("leaves a sign-up whose confirmation link is still valid", async () => {
    const id = await contact("fresh", [{ segment: "armurerie", status: "pending", requestedAt: hoursBefore(71) }])

    await purgeUnconfirmedNewsletterRequests(NOW)

    expect((await contactById(id))?.email).toBe(address("fresh"))
    expect(await subscriptionsOf(id)).toEqual([{ segment: "armurerie", status: "pending" }])
  })

  it("drops only the stale extra segment of a confirmed subscriber", async () => {
    const id = await contact("subscriber", [
      { segment: "armurerie", status: "confirmed", requestedAt: hoursBefore(500) },
      { segment: "collection", status: "pending", requestedAt: hoursBefore(100) },
    ])
    await token(id, "unsubscribe", null)

    await purgeUnconfirmedNewsletterRequests(NOW)

    expect((await contactById(id))?.email).toBe(address("subscriber"))
    expect(await subscriptionsOf(id)).toEqual([{ segment: "armurerie", status: "confirmed" }])
    expect(await tokensOf(id)).toEqual([{ purpose: "unsubscribe" }])
  })

  it("puts a returning, never-confirmed contact back to its anonymous consent trace", async () => {
    const withdrawnAt = hoursBefore(2000)
    const id = await contact("returning", [
      { segment: "armurerie", status: "unsubscribed", requestedAt: hoursBefore(3000), unsubscribedAt: withdrawnAt },
      { segment: "collection", status: "pending", requestedAt: hoursBefore(80) },
    ])
    await token(id, "unsubscribe", null)

    await purgeUnconfirmedNewsletterRequests(NOW)

    const trace = await contactById(id)
    expect(trace?.email).toBeNull()
    expect(trace?.unsubscribedAt).toEqual(withdrawnAt)
    expect(await subscriptionsOf(id)).toEqual([{ segment: "armurerie", status: "unsubscribed" }])
    expect(await tokensOf(id)).toEqual([])
  })

  it("clears expired confirmation links and reports what it removed", async () => {
    const id = await contact("tokens", [{ segment: "gun_art", status: "confirmed", requestedAt: hoursBefore(500) }])
    await token(id, "confirm", hoursBefore(400))
    await token(id, "unsubscribe", null)

    const purged = await purgeUnconfirmedNewsletterRequests(NOW)

    expect(await tokensOf(id)).toEqual([{ purpose: "unsubscribe" }])
    expect(purged.expiredConfirmLinks).toBeGreaterThanOrEqual(1)
  })

  it("counts erased and anonymised contacts", async () => {
    const id = await contact("stale", [{ segment: "gun_art", status: "pending", requestedAt: hoursBefore(100) }])

    const purged = await purgeUnconfirmedNewsletterRequests(NOW)

    expect(await contactById(id)).toBeNull()
    expect(purged).toMatchObject({ pendingRequests: 1, erasedContacts: 1, anonymisedContacts: 0 })
  })
})
