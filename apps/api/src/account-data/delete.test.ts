import { createHash } from "node:crypto"
import { eq, inArray } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import {
  addresses,
  auditLogs,
  contactMessages,
  legalDocuments,
  newsletterContacts,
  newsletterSubscriptions,
  orders,
  refreshTokens,
  shipments,
  users,
} from "../db/schema.js"
import { sendAccountDeletedEmail } from "../email.js"
import { storage } from "../storage/index.js"
import {
  ACCOUNT_PASSWORD,
  createAccount,
  createOrder,
  deleteAccounts,
  setKnownPassword,
} from "../test/account-fixtures.js"
import { proFixtures } from "../test/pro-fixtures.js"
import { eraseAccount } from "./erase.js"

vi.mock("../email.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../email.js")>()),
  sendAccountDeletedEmail: vi.fn().mockResolvedValue(undefined),
}))

const EMAIL_SUFFIX = "@account-delete.local"
const DAY_MS = 24 * 60 * 60 * 1000

describe("the deletion of an account by its holder (story 12.11)", () => {
  let app: FastifyInstance
  let pro: ReturnType<typeof proFixtures>
  /** Deleted accounts lose the suite's e-mail: their ids are kept for the cleanup. */
  const deletedIds: string[] = []
  const contactIds: string[] = []

  const deleteFor = (token: string | null, payload: object) =>
    app.inject({
      method: "POST",
      url: "/api/auth/me/delete",
      ...(token && { headers: { authorization: `Bearer ${token}` } }),
      payload,
    })

  async function deleteOk(account: { id: string; token: string }) {
    const res = await deleteFor(account.token, { password: ACCOUNT_PASSWORD })
    deletedIds.push(account.id)
    return res
  }

  async function storedDocument(userId: string, values: Partial<typeof legalDocuments.$inferInsert> = {}) {
    const key = `legal/${userId}/${Math.random()}.pdf`
    await storage.put({ key, body: Buffer.from("%PDF-1.4 test"), contentType: "application/pdf" })
    const [doc] = await db
      .insert(legalDocuments)
      .values({ userId, docType: "permis_chasse", s3Key: key, s3Url: key, ...values })
      .returning({ id: legalDocuments.id, s3Key: legalDocuments.s3Key })
    return doc
  }

  const stillStored = (key: string) =>
    storage.getBytes(key).then(
      () => true,
      () => false,
    )

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    pro = proFixtures(app, "account-delete-pro")
  })

  beforeEach(() => {
    vi.mocked(sendAccountDeletedEmail).mockClear()
  })

  afterAll(async () => {
    if (contactIds.length > 0) await db.delete(newsletterContacts).where(inArray(newsletterContacts.id, contactIds))
    if (deletedIds.length > 0) {
      const orderIds = (await db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, deletedIds))).map(
        (row) => row.id,
      )
      if (orderIds.length > 0) {
        await db.delete(shipments).where(inArray(shipments.orderId, orderIds))
        await db.delete(auditLogs).where(inArray(auditLogs.orderId, orderIds))
        await db.delete(orders).where(inArray(orders.id, orderIds))
      }
      await db.delete(auditLogs).where(inArray(auditLogs.entityId, deletedIds))
      await db.delete(auditLogs).where(inArray(auditLogs.userId, deletedIds))
      await db.delete(users).where(inArray(users.id, deletedIds))
    }
    await deleteAccounts(EMAIL_SUFFIX)
    await pro.cleanup()
    await app.close()
  })

  describe("who can delete, and when", () => {
    it("needs a session and the password again", async () => {
      expect((await deleteFor(null, { password: ACCOUNT_PASSWORD })).statusCode).toBe(401)
      const account = await createAccount(app, EMAIL_SUFFIX)
      const res = await deleteFor(account.token, { password: "not-the-password" })
      expect(res.statusCode).toBe(403)
      expect(res.json().error).toBe("InvalidCredentials")
    })

    it("asks for the app's code when the account has the app on", async () => {
      const account = await createAccount(app, EMAIL_SUFFIX, { withApp: true })
      const res = await deleteFor(account.token, { password: ACCOUNT_PASSWORD })
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe("TotpCodeRequired")
    })

    it("is not offered to an admin", async () => {
      const admin = await createAccount(app, EMAIL_SUFFIX, { role: "admin" })
      const res = await deleteFor(admin.token, { password: ACCOUNT_PASSWORD })
      expect(res.statusCode).toBe(403)
      expect(res.json().error).toBe("AdminAccount")
    })

    it("is not offered to an organisation's account: SCS closes it", async () => {
      const account = await pro.account({ organisation: "approved" })
      await setKnownPassword(account.id)
      const res = await deleteFor(account.token, { password: ACCOUNT_PASSWORD })
      expect(res.statusCode).toBe(403)
      expect(res.json().error).toBe("OrganisationAccount")
    })

    it("waits for an unpaid order to be paid or cancelled", async () => {
      const account = await createAccount(app, EMAIL_SUFFIX)
      await createOrder(account.id, { paymentStatus: "awaiting_transfer" })
      const res = await deleteFor(account.token, { password: ACCOUNT_PASSWORD })
      expect(res.statusCode).toBe(409)
      expect(res.json().error).toBe("OrderInProgress")
    })

    it("waits for a paid order to be delivered and its withdrawal period over", async () => {
      const shippedOnly = await createAccount(app, EMAIL_SUFFIX)
      await createOrder(shippedOnly.id, { paymentStatus: "received", shippingStatus: "shipped" })
      expect((await deleteFor(shippedOnly.token, { password: ACCOUNT_PASSWORD })).json().error).toBe("OrderInProgress")

      const deliveredRecently = await createAccount(app, EMAIL_SUFFIX)
      const recent = await createOrder(deliveredRecently.id, { paymentStatus: "received", shippingStatus: "delivered" })
      await db.insert(shipments).values({
        position: 1,
        carrier: "colissimo",
        orderId: recent.id,
        status: "delivered",
        deliveredAt: new Date(Date.now() - 3 * DAY_MS),
      })
      expect((await deleteFor(deliveredRecently.token, { password: ACCOUNT_PASSWORD })).json().error).toBe(
        "OrderInProgress",
      )
    })

    it("lets go once every order is over: delivered long ago, or cancelled", async () => {
      const account = await createAccount(app, EMAIL_SUFFIX)
      const old = await createOrder(account.id, { paymentStatus: "received", shippingStatus: "delivered" })
      await db.insert(shipments).values({
        position: 1,
        carrier: "colissimo",
        orderId: old.id,
        status: "delivered",
        deliveredAt: new Date(Date.now() - 20 * DAY_MS),
      })
      await createOrder(account.id, { paymentStatus: "cancelled" })

      const res = await deleteOk(account)
      expect(res.statusCode).toBe(200)
    })
  })

  describe("what a deletion does", () => {
    it("anonymises the account and closes every session", async () => {
      const account = await createAccount(app, EMAIL_SUFFIX)
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: account.email, password: ACCOUNT_PASSWORD },
      })
      expect(login.statusCode).toBe(200)

      const res = await deleteOk(account)
      expect(res.statusCode).toBe(200)

      const [row] = await db.select().from(users).where(eq(users.id, account.id))
      expect(row.deletedAt).not.toBeNull()
      expect(row.email).not.toBe(account.email)
      expect(row.email).toMatch(/@deleted\.invalid$/)
      expect(row).toMatchObject({
        firstname: null,
        lastname: null,
        phone: null,
        addressStreet: null,
        addressPostal: null,
        addressCity: null,
        totpSecretEncrypted: null,
        totpEnabledAt: null,
      })
      expect(await db.select().from(refreshTokens).where(eq(refreshTokens.userId, account.id))).toEqual([])

      // The old address no longer opens anything, and the session in hand is refused.
      const again = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: account.email, password: ACCOUNT_PASSWORD },
      })
      expect(again.statusCode).toBe(401)
      const me = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${account.token}` },
      })
      expect(me.statusCode).toBe(401)
    })

    it("removes the address book, keeps the orders with their own copy of the addresses", async () => {
      const account = await createAccount(app, EMAIL_SUFFIX)
      await db.insert(addresses).values({
        userId: account.id,
        firstName: "Jeanne",
        lastName: "Armand",
        line1: "12 rue des Lilas",
        postal: "75011",
        city: "Paris",
      })
      const order = await createOrder(account.id, { paymentStatus: "cancelled" })

      await deleteOk(account)

      expect(await db.select().from(addresses).where(eq(addresses.userId, account.id))).toEqual([])
      const [kept] = await db.select({ id: orders.id }).from(orders).where(eq(orders.id, order.id))
      expect(kept?.id).toBe(order.id)
    })

    it("keeps the documents an order relied on, erases the others with their files", async () => {
      const account = await createAccount(app, EMAIL_SUFFIX)
      const relied = await storedDocument(account.id, {
        verificationStatus: "approved",
        uploadedAt: new Date(Date.now() - 60 * DAY_MS),
      })
      const neverUsed = await storedDocument(account.id, { verificationStatus: "pending" })
      const old = await createOrder(account.id, {
        paymentStatus: "received",
        shippingStatus: "delivered",
        legalVerificationStatus: "completed",
        legalVerifiedAt: new Date(Date.now() - 50 * DAY_MS),
      })
      await db.insert(shipments).values({
        position: 1,
        carrier: "colissimo",
        orderId: old.id,
        status: "delivered",
        deliveredAt: new Date(Date.now() - 40 * DAY_MS),
      })

      await deleteOk(account)

      const left = await db
        .select({ id: legalDocuments.id })
        .from(legalDocuments)
        .where(eq(legalDocuments.userId, account.id))
      expect(left.map((doc) => doc.id)).toEqual([relied.id])
      expect(await stillStored(relied.s3Key)).toBe(true)
      expect(await stillStored(neverUsed.s3Key)).toBe(false)
    })

    it("erases the newsletter address, keeping only the anonymous proof of consent", async () => {
      const account = await createAccount(app, EMAIL_SUFFIX)
      const [contact] = await db
        .insert(newsletterContacts)
        .values({ email: account.email, emailHash: createHash("sha256").update(account.email).digest("hex") })
        .returning({ id: newsletterContacts.id })
      contactIds.push(contact.id)
      await db
        .insert(newsletterSubscriptions)
        .values({ contactId: contact.id, segment: "armurerie", status: "confirmed", confirmedAt: new Date() })

      await deleteOk(account)

      const [after] = await db.select().from(newsletterContacts).where(eq(newsletterContacts.id, contact.id))
      expect(after.email).toBeNull()
      expect(after.unsubscribedAt).not.toBeNull()
      const subscriptions = await db
        .select()
        .from(newsletterSubscriptions)
        .where(eq(newsletterSubscriptions.contactId, contact.id))
      expect(subscriptions.map((row) => row.status)).toEqual(["unsubscribed"])
    })

    it("erases the messages sent from the account's address through the contact form", async () => {
      const account = await createAccount(app, EMAIL_SUFFIX)
      await db
        .insert(contactMessages)
        .values({ name: "Jeanne", email: account.email, subject: "other", message: "Bonjour" })

      await deleteOk(account)

      expect(await db.select().from(contactMessages).where(eq(contactMessages.email, account.email))).toEqual([])
    })

    it("confirms by e-mail to the address it had, and journals the deletion", async () => {
      const account = await createAccount(app, EMAIL_SUFFIX)

      await deleteOk(account)

      expect(sendAccountDeletedEmail).toHaveBeenCalledWith(account.email, { userId: account.id })
      const events = await db.select().from(auditLogs).where(eq(auditLogs.entityId, account.id))
      const deletion = events.find((event) => event.action === "user.deleted")
      expect(deletion?.newValue).toEqual({ reason: "holder_request", documentsKept: 0 })
      // The journal line names no one.
      expect(JSON.stringify(deletion)).not.toContain(account.email)
    })

    it("scrubs what the account's own journal lines said, keeping its orders' history", async () => {
      const account = await createAccount(app, EMAIL_SUFFIX)
      const order = await createOrder(account.id, { paymentStatus: "cancelled" })
      const [profileLine] = await db
        .insert(auditLogs)
        .values({
          userId: account.id,
          userRole: "customer",
          entityType: "user",
          entityId: account.id,
          action: "user.profile_updated",
          oldValue: { phone: "+33600000000" },
          newValue: { firstName: "Jeanne", phone: "+33612345678" },
        })
        .returning({ id: auditLogs.id })
      const [orderLine] = await db
        .insert(auditLogs)
        .values({
          userRole: "system",
          entityType: "order",
          entityId: order.id,
          orderId: order.id,
          action: "email.order_confirmation.sent",
          newValue: { recipient: account.email },
        })
        .returning({ id: auditLogs.id })

      await deleteOk(account)

      const [scrubbed] = await db.select().from(auditLogs).where(eq(auditLogs.id, profileLine.id))
      expect(scrubbed).toMatchObject({ action: "user.profile_updated", oldValue: null, newValue: null })
      // An order's history is kept whole for its 10 years.
      const [kept] = await db.select().from(auditLogs).where(eq(auditLogs.id, orderLine.id))
      expect(kept.newValue).toEqual({ recipient: account.email })
    })
  })

  describe("the erasure itself", () => {
    it("checks for a running order inside its own transaction, and leaves the account alone", async () => {
      const account = await createAccount(app, EMAIL_SUFFIX)
      await createOrder(account.id, { paymentStatus: "awaiting_transfer" })

      const result = await eraseAccount(account.id, new Date())

      expect(result).toEqual({ blocker: "OrderInProgress" })
      const [row] = await db.select().from(users).where(eq(users.id, account.id))
      expect(row.deletedAt).toBeNull()
      expect(row.email).toBe(account.email)
    })
  })
})
