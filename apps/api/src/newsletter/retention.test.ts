import { createHash } from "node:crypto"
import { eq, inArray } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db } from "../db/client.js"
import { newsletterContacts, newsletterSubscriptions, newsletterTokens } from "../db/schema.js"
import { purgeNewsletterRetention } from "./retention.js"

const NOW = new Date("2026-10-20T03:00:00Z")
const hoursBefore = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000)

const address = (name: string) => `newsletter-retention-${name}@example.test`
const hashOf = (email: string) => createHash("sha256").update(email).digest("hex")
const NAMES = ["stale", "fresh", "subscriber", "returning", "tokens", "old-trace", "recent-trace", "active"] as const
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

/** The trace an unsubscribe leaves: no address, the withdrawal date, the consent proof on each segment. */
async function trace(name: (typeof NAMES)[number], unsubscribedAt: Date): Promise<string> {
  const [row] = await db
    .insert(newsletterContacts)
    .values({ email: null, emailHash: hashOf(address(name)), unsubscribedAt })
    .returning({ id: newsletterContacts.id })
  await db.insert(newsletterSubscriptions).values({
    contactId: row.id,
    segment: "armurerie",
    status: "unsubscribed",
    requestedAt: new Date("2019-01-01T00:00:00Z"),
    unsubscribedAt,
    consentIp: "203.0.113.7",
    consentUserAgent: "Mozilla/5.0",
  })
  return row.id
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

    await purgeNewsletterRetention(NOW)

    expect(await contactById(id)).toBeNull()
    expect(await tokensOf(id)).toEqual([])
  })

  it("leaves a sign-up whose confirmation link is still valid", async () => {
    const id = await contact("fresh", [{ segment: "armurerie", status: "pending", requestedAt: hoursBefore(71) }])

    await purgeNewsletterRetention(NOW)

    expect((await contactById(id))?.email).toBe(address("fresh"))
    expect(await subscriptionsOf(id)).toEqual([{ segment: "armurerie", status: "pending" }])
  })

  it("drops only the stale extra segment of a confirmed subscriber", async () => {
    const id = await contact("subscriber", [
      { segment: "armurerie", status: "confirmed", requestedAt: hoursBefore(500) },
      { segment: "collection", status: "pending", requestedAt: hoursBefore(100) },
    ])
    await token(id, "unsubscribe", null)

    await purgeNewsletterRetention(NOW)

    expect((await contactById(id))?.email).toBe(address("subscriber"))
    expect(await subscriptionsOf(id)).toEqual([{ segment: "armurerie", status: "confirmed" }])
    expect(await tokensOf(id)).toEqual([{ purpose: "unsubscribe" }])
  })

  it("puts a returning, never-confirmed contact back to its consent proof, address erased", async () => {
    const withdrawnAt = hoursBefore(2000)
    const id = await contact("returning", [
      { segment: "armurerie", status: "unsubscribed", requestedAt: hoursBefore(3000), unsubscribedAt: withdrawnAt },
      { segment: "collection", status: "pending", requestedAt: hoursBefore(80) },
    ])
    await token(id, "unsubscribe", null)

    await purgeNewsletterRetention(NOW)

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

    const purged = await purgeNewsletterRetention(NOW)

    expect(await tokensOf(id)).toEqual([{ purpose: "unsubscribe" }])
    expect(purged.expiredConfirmLinks).toBeGreaterThanOrEqual(1)
  })

  it("counts erased contacts and erased addresses", async () => {
    const id = await contact("stale", [{ segment: "gun_art", status: "pending", requestedAt: hoursBefore(100) }])

    const purged = await purgeNewsletterRetention(NOW)

    expect(await contactById(id)).toBeNull()
    expect(purged).toMatchObject({ pendingRequests: 1, erasedContacts: 1, addressesErased: 0 })
  })
})

// Decision Franck 2026-11-04 (audit B7): the consent proof an unsubscribe leaves
// (address hash, dates, IP, browser) is kept 5 years, then erased.
describe("newsletter retention — the consent proof after an unsubscribe", () => {
  beforeAll(cleanup)
  afterAll(cleanup)

  it("erases the proof five years after the unsubscribe, its segments with it", async () => {
    const old = await trace("old-trace", new Date("2021-10-19T03:00:00Z"))
    const recent = await trace("recent-trace", new Date("2021-10-21T03:00:00Z"))

    const purged = await purgeNewsletterRetention(NOW)

    expect(await contactById(old)).toBeNull()
    expect(await subscriptionsOf(old)).toEqual([])
    expect((await contactById(recent))?.unsubscribedAt).toEqual(new Date("2021-10-21T03:00:00Z"))
    expect(await subscriptionsOf(recent)).toEqual([{ segment: "armurerie", status: "unsubscribed" }])
    expect(purged.expiredConsentProofs).toBeGreaterThanOrEqual(1)
  })

  it("keeps a subscriber who still has an address, however old a withdrawn segment is", async () => {
    const id = await contact("active", [
      { segment: "armurerie", status: "confirmed", requestedAt: new Date("2019-01-01T00:00:00Z") },
      {
        segment: "collection",
        status: "unsubscribed",
        requestedAt: new Date("2019-01-01T00:00:00Z"),
        unsubscribedAt: new Date("2020-01-01T00:00:00Z"),
      },
    ])
    await db
      .update(newsletterContacts)
      .set({ unsubscribedAt: new Date("2020-01-01T00:00:00Z") })
      .where(eq(newsletterContacts.id, id))

    await purgeNewsletterRetention(NOW)

    expect((await contactById(id))?.email).toBe(address("active"))
  })
})
