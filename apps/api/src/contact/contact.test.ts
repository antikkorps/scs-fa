import { EMPTY_SHOP_IDENTITY, type ShopIdentity } from "@armurier/shared"
import { eq, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, contactMessages } from "../db/schema.js"
import { sendContactMessageAlertEmail } from "../email.js"
import { loadShopIdentity, saveShopIdentity } from "../shop-identity/service.js"
import { createAccount, deleteAccounts } from "../test/account-fixtures.js"
import { purgeContactMessages } from "./retention.js"

vi.mock("../email.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../email.js")>()),
  sendContactMessageAlertEmail: vi.fn().mockResolvedValue(undefined),
}))

const EMAIL_SUFFIX = "@contact-form.local"
const DAY_MS = 24 * 60 * 60 * 1000

describe("the contact form (audit 2026-11-01, I8b)", () => {
  let app: FastifyInstance
  let original: ShopIdentity
  let sequence = 0

  const sender = () => `visitor-${Date.now()}-${sequence++}${EMAIL_SUFFIX}`
  const valid = (email = sender()) => ({
    name: "Jeanne Armand",
    email,
    subject: "order",
    orderReference: "7C338E18",
    message: "Bonjour, où en est ma commande ?",
    filledInMs: 20_000,
  })
  const send = (payload: object) =>
    app.inject({
      method: "POST",
      url: "/api/contact",
      payload,
      remoteAddress: `10.9.${sequence % 250}.${sequence++ % 250}`,
    })
  const stored = (email: string) => db.select().from(contactMessages).where(eq(contactMessages.email, email))

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    original = await loadShopIdentity()
    await saveShopIdentity({ ...EMPTY_SHOP_IDENTITY, email: "contact@scs-firearms.fr" })
  })

  beforeEach(() => {
    vi.mocked(sendContactMessageAlertEmail).mockClear()
  })

  afterAll(async () => {
    await db.delete(contactMessages).where(like(contactMessages.email, `%${EMAIL_SUFFIX}`))
    await saveShopIdentity(original)
    await deleteAccounts(EMAIL_SUFFIX)
    await app.close()
  })

  describe("sending", () => {
    it("keeps the message and tells the shop, the sender as the address to reply to", async () => {
      const payload = valid()
      const res = await send(payload)

      expect(res.statusCode).toBe(201)
      const [row] = await stored(payload.email)
      expect(row).toMatchObject({ name: "Jeanne Armand", subject: "order", orderReference: "7C338E18", status: "new" })
      expect(sendContactMessageAlertEmail).toHaveBeenCalledWith(
        ["contact@scs-firearms.fr"],
        expect.objectContaining({ id: row.id, replyTo: payload.email, subject: "order" }),
      )
    })

    it("pretends to accept a robot's message, and keeps nothing", async () => {
      const trapped = valid()
      expect((await send({ ...trapped, website: "http://spam.example" })).statusCode).toBe(201)
      const hurried = valid()
      expect((await send({ ...hurried, filledInMs: 400 })).statusCode).toBe(201)

      expect(await stored(trapped.email)).toEqual([])
      expect(await stored(hurried.email)).toEqual([])
      expect(sendContactMessageAlertEmail).not.toHaveBeenCalled()
    })

    it("refuses a malformed message", async () => {
      expect((await send({ ...valid(), email: "pas-un-email" })).statusCode).toBe(400)
    })

    it("limits one address to three messages an hour, whatever the network", async () => {
      const email = sender()
      for (let i = 0; i < 3; i++) expect((await send(valid(email))).statusCode).toBe(201)
      const fourth = await send(valid(email))
      expect(fourth.statusCode).toBe(429)
      expect(fourth.json().error).toBe("TooManyMessages")
      expect(await stored(email)).toHaveLength(3)
    })

    it("tells the admins when the shop has no contact address yet", async () => {
      await saveShopIdentity(EMPTY_SHOP_IDENTITY)
      const admin = await createAccount(app, EMAIL_SUFFIX, { role: "admin" })

      expect((await send(valid())).statusCode).toBe(201)

      const [recipients] = vi.mocked(sendContactMessageAlertEmail).mock.calls[0] ?? []
      expect(recipients).toContain(admin.email)
      await saveShopIdentity({ ...EMPTY_SHOP_IDENTITY, email: "contact@scs-firearms.fr" })
    })
  })

  describe("the admins' inbox", () => {
    it("lists the messages to handle, and marks one handled — journaled", async () => {
      const admin = await createAccount(app, EMAIL_SUFFIX, { role: "admin" })
      const payload = valid()
      await send(payload)
      const [row] = await stored(payload.email)
      const auth = { authorization: `Bearer ${admin.token}` }

      const list = await app.inject({ method: "GET", url: "/api/admin/contact-messages?status=new", headers: auth })
      expect(list.statusCode).toBe(200)
      expect(list.json().data.map((m: { id: string }) => m.id)).toContain(row.id)

      const handled = await app.inject({
        method: "PATCH",
        url: `/api/admin/contact-messages/${row.id}`,
        headers: auth,
        payload: { status: "handled" },
      })
      expect(handled.statusCode).toBe(200)
      const [after] = await stored(payload.email)
      expect(after).toMatchObject({ status: "handled", handledBy: admin.id })
      expect(after.handledAt).not.toBeNull()
      const events = await db.select().from(auditLogs).where(eq(auditLogs.entityId, row.id))
      expect(events.map((event) => event.action)).toContain("contact_message.handled")
    })

    it("is for admins only", async () => {
      const customer = await createAccount(app, EMAIL_SUFFIX)
      const res = await app.inject({
        method: "GET",
        url: "/api/admin/contact-messages",
        headers: { authorization: `Bearer ${customer.token}` },
      })
      expect(res.statusCode).toBe(403)
    })
  })

  describe("retention", () => {
    it("deletes a message a year after it was handled, or a year after receipt if never handled", async () => {
      const now = new Date()
      const ago = (days: number) => new Date(now.getTime() - days * DAY_MS)
      const insert = (values: Partial<typeof contactMessages.$inferInsert>) =>
        db
          .insert(contactMessages)
          .values({ name: "R", email: sender(), subject: "other", message: "m", ...values })
          .returning({ id: contactMessages.id })
      const [oldHandled] = await insert({ status: "handled", handledAt: ago(370), createdAt: ago(400) })
      const [recentHandled] = await insert({ status: "handled", handledAt: ago(30), createdAt: ago(400) })
      const [oldNew] = await insert({ createdAt: ago(370) })
      const [recentNew] = await insert({ createdAt: ago(30) })

      const done = await purgeContactMessages(now)

      expect(done.messages).toBeGreaterThanOrEqual(2)
      const left = (await db.select({ id: contactMessages.id }).from(contactMessages)).map((row) => row.id)
      expect(left).not.toContain(oldHandled.id)
      expect(left).not.toContain(oldNew.id)
      expect(left).toContain(recentHandled.id)
      expect(left).toContain(recentNew.id)
    })
  })
})
