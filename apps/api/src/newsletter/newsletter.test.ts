import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, newsletterContacts, newsletterSubscriptions, newsletterTokens } from "../db/schema.js"

// The confirmation mail is the only way to obtain a token in the real flow, so
// the suite reads the tokens straight off the (mocked) mailer rather than out of
// the database — that also proves the links we actually send are the working ones.
type SentMail = { to: string; confirmToken: string; unsubscribeToken: string; segmentLabels: string[] }
const sentMails: SentMail[] = []
vi.mock("../email.js", () => ({
  sendNewsletterConfirmationEmail: vi.fn(async (to: string, params: Omit<SentMail, "to">) => {
    sentMails.push({ ...params, to })
  }),
  sendPasswordResetEmail: vi.fn(),
  sendLegalDocApprovedEmail: vi.fn(),
  sendLegalDocRejectedEmail: vi.fn(),
  sendLegalDocSlaBreachEmail: vi.fn(),
  sendErrorAlertEmail: vi.fn(),
}))

const EMAIL_PREFIX = "newsletter-114"
const email = (name: string) => `${EMAIL_PREFIX}-${name}@example.test`

let app: FastifyInstance

async function subscribe(body: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/api/newsletter/subscribe", payload: body })
}

/** Subscribe and hand back the tokens from the confirmation mail. */
async function subscribeAndGetTokens(address: string, segments: string[], source?: string) {
  sentMails.length = 0
  const res = await subscribe({ email: address, segments, consent: true, ...(source ? { source } : {}) })
  expect(res.statusCode).toBe(202)
  const mail = sentMails.at(-1)
  if (!mail) throw new Error("No confirmation mail was sent")
  return mail
}

async function contactRow(address: string) {
  const [row] = await db.select().from(newsletterContacts).where(eq(newsletterContacts.email, address)).limit(1)
  return row ?? null
}

async function cleanup() {
  const rows = await db
    .select({ id: newsletterContacts.id })
    .from(newsletterContacts)
    .where(like(newsletterContacts.emailHash, "%"))
  // Contacts are matched by their audit trail because the purge nulls the email.
  const logs = await db
    .select({ entityId: auditLogs.entityId })
    .from(auditLogs)
    .where(like(auditLogs.action, "newsletter.%"))
  const ids = new Set(logs.map((l) => l.entityId).filter((id): id is string => id !== null))
  const known = rows.filter((r) => ids.has(r.id)).map((r) => r.id)
  if (known.length > 0) await db.delete(newsletterContacts).where(inArray(newsletterContacts.id, known))
  await db.delete(auditLogs).where(like(auditLogs.action, "newsletter.%"))
}

describe("Newsletter — double opt-in, segments and GDPR purge (story 11.4)", () => {
  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  beforeEach(() => {
    sentMails.length = 0
  })

  it("captures an address as pending and mails a confirmation link", async () => {
    const address = email("pending")
    const mail = await subscribeAndGetTokens(address, ["armurerie"], "/boutique")

    expect(mail.to).toBe(address)
    expect(mail.confirmToken).not.toBe(mail.unsubscribeToken)

    const contact = await contactRow(address)
    expect(contact).not.toBeNull()
    const subs = await db
      .select()
      .from(newsletterSubscriptions)
      .where(eq(newsletterSubscriptions.contactId, contact?.id ?? ""))
    // Pending, never mailable, and the proof of consent is recorded with it.
    expect(subs).toHaveLength(1)
    expect(subs[0]?.status).toBe("pending")
    expect(subs[0]?.confirmedAt).toBeNull()
    expect(subs[0]?.consentSource).toBe("/boutique")
    expect(subs[0]?.consentIp).toBeTruthy()
  })

  it("normalises the address and refuses an unticked consent box", async () => {
    const address = email("case")
    await subscribeAndGetTokens(address.toUpperCase(), ["gun_art"])
    expect(await contactRow(address)).not.toBeNull()

    const res = await subscribe({ email: email("noconsent"), segments: ["armurerie"], consent: false })
    expect(res.statusCode).toBe(400)
    expect(await contactRow(email("noconsent"))).toBeNull()
  })

  it("refuses an empty segment selection rather than subscribing to everything", async () => {
    const res = await subscribe({ email: email("nosegment"), segments: [], consent: true })
    expect(res.statusCode).toBe(400)
  })

  it("confirms the opt-in and only then exposes the contact to the provider", async () => {
    const address = email("confirm")
    const mail = await subscribeAndGetTokens(address, ["armurerie", "collection"])

    const res = await app.inject({
      method: "POST",
      url: "/api/newsletter/confirm",
      payload: { token: mail.confirmToken },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.segments.sort()).toEqual(["armurerie", "collection"])

    const contact = await contactRow(address)
    const subs = await db
      .select()
      .from(newsletterSubscriptions)
      .where(eq(newsletterSubscriptions.contactId, contact?.id ?? ""))
    expect(subs.every((s) => s.status === "confirmed" && s.confirmedAt !== null)).toBe(true)
    // The in-memory driver stands in for Brevo: a successful sync stamps the row.
    expect(subs.every((s) => s.providerSyncedAt !== null)).toBe(true)
  })

  it("burns the confirmation link after use and rejects an unknown one", async () => {
    const mail = await subscribeAndGetTokens(email("replay"), ["gun_art"])
    const confirm = () =>
      app.inject({ method: "POST", url: "/api/newsletter/confirm", payload: { token: mail.confirmToken } })

    expect((await confirm()).statusCode).toBe(200)
    expect((await confirm()).statusCode).toBe(400)

    const unknown = await app.inject({
      method: "POST",
      url: "/api/newsletter/confirm",
      payload: { token: "x".repeat(43) },
    })
    expect(unknown.statusCode).toBe(400)
  })

  it("refuses an expired confirmation link", async () => {
    const address = email("expired")
    const mail = await subscribeAndGetTokens(address, ["armurerie"])
    const contact = await contactRow(address)
    await db
      .update(newsletterTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(newsletterTokens.contactId, contact?.id ?? ""))

    const res = await app.inject({
      method: "POST",
      url: "/api/newsletter/confirm",
      payload: { token: mail.confirmToken },
    })
    expect(res.statusCode).toBe(400)
  })

  it("adds a segment without demoting one already confirmed", async () => {
    const address = email("addsegment")
    const first = await subscribeAndGetTokens(address, ["armurerie"])
    await app.inject({ method: "POST", url: "/api/newsletter/confirm", payload: { token: first.confirmToken } })

    const second = await subscribeAndGetTokens(address, ["armurerie", "gun_art"])
    // Only the genuinely new segment needs confirming — the mail says so.
    expect(second.segmentLabels).toHaveLength(1)

    const contact = await contactRow(address)
    const before = await db
      .select()
      .from(newsletterSubscriptions)
      .where(eq(newsletterSubscriptions.contactId, contact?.id ?? ""))
    expect(before.find((s) => s.segment === "armurerie")?.status).toBe("confirmed")
    expect(before.find((s) => s.segment === "gun_art")?.status).toBe("pending")
  })

  it("unsubscribes one segment and keeps the others (and the address)", async () => {
    const address = email("partial")
    const mail = await subscribeAndGetTokens(address, ["armurerie", "collection"])
    await app.inject({ method: "POST", url: "/api/newsletter/confirm", payload: { token: mail.confirmToken } })

    const res = await app.inject({
      method: "POST",
      url: "/api/newsletter/unsubscribe",
      payload: { token: mail.unsubscribeToken, segments: ["collection"] },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ segments: ["armurerie"], purged: false })
    expect(await contactRow(address)).not.toBeNull()

    // The link still works — it travels in every letter, it is not single-use.
    const listing = await app.inject({
      method: "GET",
      url: `/api/newsletter/subscription?token=${mail.unsubscribeToken}`,
    })
    expect(listing.statusCode).toBe(200)
    expect(listing.json().data.segments).toEqual([{ segment: "armurerie", status: "confirmed" }])
  })

  it("purges the address on a full unsubscribe but keeps an anonymous consent trace", async () => {
    const address = email("purge")
    const mail = await subscribeAndGetTokens(address, ["armurerie", "gun_art"])
    await app.inject({ method: "POST", url: "/api/newsletter/confirm", payload: { token: mail.confirmToken } })
    const contactId = (await contactRow(address))?.id ?? ""

    const res = await app.inject({
      method: "POST",
      url: "/api/newsletter/unsubscribe",
      payload: { token: mail.unsubscribeToken },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ segments: [], purged: true })

    const [row] = await db.select().from(newsletterContacts).where(eq(newsletterContacts.id, contactId)).limit(1)
    expect(row?.email).toBeNull()
    expect(row?.emailHash).toBeTruthy()
    expect(row?.unsubscribedAt).not.toBeNull()

    // Withdrawal stays provable per segment, and the links stop resolving.
    const subs = await db.select().from(newsletterSubscriptions).where(eq(newsletterSubscriptions.contactId, contactId))
    expect(subs.every((s) => s.status === "unsubscribed" && s.unsubscribedAt !== null)).toBe(true)
    const tokens = await db.select().from(newsletterTokens).where(eq(newsletterTokens.contactId, contactId))
    expect(tokens).toHaveLength(0)

    const reuse = await app.inject({
      method: "POST",
      url: "/api/newsletter/unsubscribe",
      payload: { token: mail.unsubscribeToken },
    })
    expect(reuse.statusCode).toBe(400)
  })

  it("re-subscribing after a purge reuses the same contact row", async () => {
    const address = email("resub")
    const first = await subscribeAndGetTokens(address, ["armurerie"])
    await app.inject({ method: "POST", url: "/api/newsletter/confirm", payload: { token: first.confirmToken } })
    const originalId = (await contactRow(address))?.id ?? ""
    await app.inject({
      method: "POST",
      url: "/api/newsletter/unsubscribe",
      payload: { token: first.unsubscribeToken },
    })

    await subscribeAndGetTokens(address, ["armurerie"])
    const again = await contactRow(address)
    expect(again?.id).toBe(originalId)
    expect(again?.unsubscribedAt).toBeNull()
  })

  it("never echoes the address back from an unsubscribe link", async () => {
    const address = email("noecho")
    const mail = await subscribeAndGetTokens(address, ["collection"])
    const res = await app.inject({
      method: "GET",
      url: `/api/newsletter/subscription?token=${mail.unsubscribeToken}`,
    })
    expect(res.statusCode).toBe(200)
    expect(res.payload).not.toContain(address)
  })

  it("records a timestamped audit trail for consent and withdrawal", async () => {
    const address = email("audit")
    const mail = await subscribeAndGetTokens(address, ["armurerie"])
    const contactId = (await contactRow(address))?.id ?? ""
    await app.inject({ method: "POST", url: "/api/newsletter/confirm", payload: { token: mail.confirmToken } })
    await app.inject({
      method: "POST",
      url: "/api/newsletter/unsubscribe",
      payload: { token: mail.unsubscribeToken },
    })

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.entityId, contactId))
    expect(logs.map((l) => l.action).sort()).toEqual([
      "newsletter.confirmed",
      "newsletter.subscribe_requested",
      "newsletter.unsubscribed",
    ])
    expect(logs.every((l) => l.createdAt !== null)).toBe(true)
  })
})
