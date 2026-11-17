import { and, eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, newsletterContacts, newsletterSubscriptions, newsletterTokens } from "../db/schema.js"
import { sendNewsletterConfirmationEmail } from "../email.js"

vi.mock("../email.js", () => ({
  sendNewsletterConfirmationEmail: vi.fn(async () => undefined),
  sendErrorAlertEmail: vi.fn(),
}))

const EMAIL_PREFIX = "newsletter-abuse"
const address = (name: string) => `${EMAIL_PREFIX}-${name}@example.test`
const sent = vi.mocked(sendNewsletterConfirmationEmail)

let app: FastifyInstance

const subscribe = (email: string, extra: Record<string, unknown> = {}) =>
  app.inject({
    method: "POST",
    url: "/api/newsletter/subscribe",
    payload: { email, segments: ["gun_art"], consent: true, filledInMs: 8000, website: "", ...extra },
  })

const contactOf = async (email: string) =>
  (await db.select().from(newsletterContacts).where(eq(newsletterContacts.email, email)))[0] ?? null

async function cleanup() {
  const rows = await db
    .select({ id: newsletterContacts.id })
    .from(newsletterContacts)
    .where(like(newsletterContacts.email, `${EMAIL_PREFIX}%`))
  const ids = rows.map((row) => row.id)
  if (ids.length > 0) {
    await db.delete(auditLogs).where(inArray(auditLogs.entityId, ids))
    await db.delete(newsletterContacts).where(inArray(newsletterContacts.id, ids))
  }
}

describe("newsletter sign-up abuse: robots and mail bombing", () => {
  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()
  })

  beforeEach(async () => {
    await cleanup()
    sent.mockClear()
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it("answers a robot that fills the hidden field like anyone, but stores and sends nothing", async () => {
    const human = await subscribe(address("human"))
    const robot = await subscribe(address("robot"), { website: "http://spam.example" })

    expect(robot.statusCode).toBe(human.statusCode)
    expect(robot.json()).toEqual(human.json())
    expect(await contactOf(address("robot"))).toBeNull()
    expect(sent).toHaveBeenCalledTimes(1)
  })

  it("treats a form sent faster than a person can as a robot", async () => {
    const res = await subscribe(address("fast"), { filledInMs: 200 })
    expect(res.statusCode).toBe(202)
    expect(await contactOf(address("fast"))).toBeNull()
    expect(sent).not.toHaveBeenCalled()
  })

  it("refuses a request without the fill time: the page always sends it", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/newsletter/subscribe",
      payload: { email: address("bare"), segments: ["gun_art"], consent: true },
    })
    expect(res.statusCode).toBe(400)
  })

  it("does not mail a pending address again while its last link is fresh", async () => {
    const first = await subscribe(address("victim"))
    const again = await subscribe(address("victim"), { segments: ["armurerie"] })

    // Same answer: nothing tells the caller the address is already waiting.
    expect(again.statusCode).toBe(202)
    expect(again.json()).toEqual(first.json())
    expect(sent).toHaveBeenCalledTimes(1)
  })

  it("changes nothing while the link is fresh: a universe added by someone else is never confirmed by it", async () => {
    await subscribe(address("held"))
    await subscribe(address("held"), { segments: ["armurerie"] })

    const contact = await contactOf(address("held"))
    const segments = await db
      .select({ segment: newsletterSubscriptions.segment })
      .from(newsletterSubscriptions)
      .where(eq(newsletterSubscriptions.contactId, contact?.id ?? ""))
    expect(segments.map((row) => row.segment)).toEqual(["gun_art"])
  })

  it("still mails a subscriber who confirmed and adds a universe", async () => {
    await subscribe(address("adds"))
    const confirmToken = sent.mock.calls[0]?.[1].confirmToken
    await app.inject({ method: "POST", url: "/api/newsletter/confirm", payload: { token: confirmToken } })

    await subscribe(address("adds"), { segments: ["armurerie"] })
    expect(sent).toHaveBeenCalledTimes(2)
  })

  it("sends one mail for simultaneous requests on the same address", async () => {
    await Promise.all(Array.from({ length: 5 }, () => subscribe(address("burst"))))
    expect(sent).toHaveBeenCalledTimes(1)
  })

  it("lets the visitor ask again at once when the mail could not be sent", async () => {
    sent.mockRejectedValueOnce(new Error("provider down"))
    await subscribe(address("failed"))
    const contact = await contactOf(address("failed"))
    const confirmLinks = () =>
      db
        .select({ id: newsletterTokens.id })
        .from(newsletterTokens)
        .where(and(eq(newsletterTokens.contactId, contact?.id ?? ""), eq(newsletterTokens.purpose, "confirm")))
    await vi.waitFor(async () => expect(await confirmLinks()).toHaveLength(0))

    await subscribe(address("failed"))
    expect(sent).toHaveBeenCalledTimes(2)
  })

  it("mails it again once the last link is old enough", async () => {
    await subscribe(address("later"))
    const contact = await contactOf(address("later"))
    await db
      .update(newsletterTokens)
      .set({ createdAt: new Date(Date.now() - 16 * 60 * 1000) })
      .where(eq(newsletterTokens.contactId, contact?.id ?? ""))

    await subscribe(address("later"))
    expect(sent).toHaveBeenCalledTimes(2)
  })
})
