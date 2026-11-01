import { eq, inArray } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, legalDocuments, orders, refreshTokens, users } from "../db/schema.js"
import { sendAccountDeletedEmail, sendInactiveAccountWarningEmail } from "../email.js"
import { storage } from "../storage/index.js"
import { createAccount, createOrder, deleteAccounts } from "../test/account-fixtures.js"
import { proFixtures } from "../test/pro-fixtures.js"
import { purgeInactiveAccounts } from "./inactivity.js"

vi.mock("../email.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../email.js")>()),
  sendAccountDeletedEmail: vi.fn().mockResolvedValue(undefined),
  sendInactiveAccountWarningEmail: vi.fn().mockResolvedValue(undefined),
}))

const EMAIL_SUFFIX = "@account-inactivity.local"
const DAY_MS = 24 * 60 * 60 * 1000
const YEAR_MS = 365 * DAY_MS

describe("the purge of inactive accounts (story 12.11)", () => {
  let app: FastifyInstance
  let pro: ReturnType<typeof proFixtures>
  const now = new Date()
  const ago = (ms: number) => new Date(now.getTime() - ms)
  /** Erased accounts lose the suite's e-mail: their ids are kept for the cleanup. */
  const erasedIds: string[] = []

  const userRow = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0]

  async function warned(id: string, at: Date) {
    await db.update(users).set({ inactivityWarnedAt: at }).where(eq(users.id, id))
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    pro = proFixtures(app, "account-inactivity-pro")
  })

  beforeEach(() => {
    vi.mocked(sendAccountDeletedEmail).mockClear()
    vi.mocked(sendInactiveAccountWarningEmail).mockClear()
  })

  afterAll(async () => {
    if (erasedIds.length > 0) {
      await db.delete(legalDocuments).where(inArray(legalDocuments.userId, erasedIds))
      await db.delete(orders).where(inArray(orders.userId, erasedIds))
      await db.delete(auditLogs).where(inArray(auditLogs.entityId, erasedIds))
      await db.delete(users).where(inArray(users.id, erasedIds))
    }
    await deleteAccounts(EMAIL_SUFFIX)
    await pro.cleanup()
    await app.close()
  })

  describe("the warning", () => {
    it("goes to an account with no login for 3 years and no order since", async () => {
      const account = await createAccount(app, EMAIL_SUFFIX, {
        lastLoginAt: ago(4 * YEAR_MS),
        createdAt: ago(5 * YEAR_MS),
      })

      await purgeInactiveAccounts(now)

      const row = await userRow(account.id)
      expect(row.inactivityWarnedAt).toEqual(now)
      expect(row.deletedAt).toBeNull()
      expect(sendInactiveAccountWarningEmail).toHaveBeenCalledWith(
        account.email,
        { deletionDate: new Date(now.getTime() + 30 * DAY_MS) },
        { userId: account.id },
      )
    })

    it("dates a never-used account by its creation", async () => {
      const account = await createAccount(app, EMAIL_SUFFIX, { createdAt: ago(4 * YEAR_MS) })
      await purgeInactiveAccounts(now)
      expect((await userRow(account.id)).inactivityWarnedAt).toEqual(now)
    })

    it("spares an account active within 3 years, by login or by order", async () => {
      const loggedIn = await createAccount(app, EMAIL_SUFFIX, {
        lastLoginAt: ago(2 * YEAR_MS),
        createdAt: ago(5 * YEAR_MS),
      })
      const ordered = await createAccount(app, EMAIL_SUFFIX, {
        lastLoginAt: ago(4 * YEAR_MS),
        createdAt: ago(5 * YEAR_MS),
      })
      await createOrder(ordered.id, { paymentStatus: "cancelled", createdAt: ago(YEAR_MS) })

      await purgeInactiveAccounts(now)

      expect((await userRow(loggedIn.id)).inactivityWarnedAt).toBeNull()
      expect((await userRow(ordered.id)).inactivityWarnedAt).toBeNull()
    })

    it("never goes to an admin or an organisation's account: SCS closes those", async () => {
      const admin = await createAccount(app, EMAIL_SUFFIX, { role: "admin", createdAt: ago(5 * YEAR_MS) })
      const organisation = await pro.account({ organisation: "approved" })
      await db
        .update(users)
        .set({ createdAt: ago(5 * YEAR_MS) })
        .where(eq(users.id, organisation.id))

      await purgeInactiveAccounts(now)

      expect((await userRow(admin.id)).inactivityWarnedAt).toBeNull()
      expect((await userRow(organisation.id)).inactivityWarnedAt).toBeNull()
    })
  })

  describe("what counts as activity", () => {
    async function sessionUsed(userId: string, at: Date) {
      await db.insert(refreshTokens).values({
        userId,
        tokenHash: `inactivity-${userId}-${Math.random()}`.slice(0, 64),
        expiresAt: new Date(now.getTime() + 7 * DAY_MS),
        lastUsedAt: at,
      })
    }

    it("a session kept alive without a fresh login: the holder is still here", async () => {
      const account = await createAccount(app, EMAIL_SUFFIX, {
        lastLoginAt: ago(4 * YEAR_MS),
        createdAt: ago(5 * YEAR_MS),
      })
      await sessionUsed(account.id, ago(10 * DAY_MS))

      await purgeInactiveAccounts(now)

      expect((await userRow(account.id)).inactivityWarnedAt).toBeNull()
    })

    it("a session used after the warning keeps the account", async () => {
      const account = await createAccount(app, EMAIL_SUFFIX, {
        lastLoginAt: ago(4 * YEAR_MS),
        createdAt: ago(5 * YEAR_MS),
      })
      await warned(account.id, ago(31 * DAY_MS))
      await sessionUsed(account.id, ago(5 * DAY_MS))

      await purgeInactiveAccounts(now)

      expect((await userRow(account.id)).deletedAt).toBeNull()
    })

    it("an order placed after the warning keeps the account", async () => {
      const account = await createAccount(app, EMAIL_SUFFIX, {
        lastLoginAt: ago(4 * YEAR_MS),
        createdAt: ago(5 * YEAR_MS),
      })
      await warned(account.id, ago(31 * DAY_MS))
      await createOrder(account.id, { paymentStatus: "cancelled", createdAt: ago(20 * DAY_MS) })

      await purgeInactiveAccounts(now)

      expect((await userRow(account.id)).deletedAt).toBeNull()
    })
  })

  describe("the anonymisation, 30 days after the warning", () => {
    it("erases an account still unused, and says so", async () => {
      const account = await createAccount(app, EMAIL_SUFFIX, {
        lastLoginAt: ago(4 * YEAR_MS),
        createdAt: ago(5 * YEAR_MS),
      })
      await warned(account.id, ago(31 * DAY_MS))
      erasedIds.push(account.id)

      const done = await purgeInactiveAccounts(now)

      expect(done.erasedAccounts).toBeGreaterThanOrEqual(1)
      expect((await userRow(account.id)).deletedAt).toEqual(now)
      expect(sendAccountDeletedEmail).toHaveBeenCalledWith(account.email, { userId: account.id })
      const events = await db.select().from(auditLogs).where(eq(auditLogs.entityId, account.id))
      expect(events.find((event) => event.action === "user.deleted")?.newValue).toEqual({
        reason: "inactivity",
        documentsKept: 0,
      })
    })

    it("waits out the 30 days", async () => {
      const account = await createAccount(app, EMAIL_SUFFIX, {
        lastLoginAt: ago(4 * YEAR_MS),
        createdAt: ago(5 * YEAR_MS),
      })
      await warned(account.id, ago(10 * DAY_MS))

      await purgeInactiveAccounts(now)

      expect((await userRow(account.id)).deletedAt).toBeNull()
    })

    it("keeps an account its holder came back to after the warning, without warning it again", async () => {
      const account = await createAccount(app, EMAIL_SUFFIX, {
        lastLoginAt: ago(20 * DAY_MS),
        createdAt: ago(5 * YEAR_MS),
      })
      await warned(account.id, ago(31 * DAY_MS))

      await purgeInactiveAccounts(now)

      const row = await userRow(account.id)
      expect(row.deletedAt).toBeNull()
      expect(row.inactivityWarnedAt).toEqual(ago(31 * DAY_MS))
      expect(sendInactiveAccountWarningEmail).not.toHaveBeenCalledWith(
        account.email,
        expect.anything(),
        expect.anything(),
      )
    })

    it("leaves an account with an order still running to the holder's own deletion", async () => {
      const account = await createAccount(app, EMAIL_SUFFIX, {
        lastLoginAt: ago(4 * YEAR_MS),
        createdAt: ago(5 * YEAR_MS),
      })
      // Placed long ago, never shipped: still "in progress", so never erased automatically.
      await createOrder(account.id, { paymentStatus: "received", createdAt: ago(4 * YEAR_MS) })
      await warned(account.id, ago(31 * DAY_MS))

      await purgeInactiveAccounts(now)

      expect((await userRow(account.id)).deletedAt).toBeNull()
    })
  })

  describe("the documents a deleted account's orders relied on", () => {
    async function deletedAccountWithDocument(lastVerification: Date) {
      const account = await createAccount(app, EMAIL_SUFFIX)
      erasedIds.push(account.id)
      const key = `legal/${account.id}/kept.pdf`
      await storage.put({ key, body: Buffer.from("%PDF-1.4 test"), contentType: "application/pdf" })
      const [doc] = await db
        .insert(legalDocuments)
        .values({ userId: account.id, docType: "cni", s3Key: key, s3Url: key, verificationStatus: "approved" })
        .returning({ id: legalDocuments.id })
      await createOrder(account.id, { paymentStatus: "cancelled", legalVerifiedAt: lastVerification })
      await db
        .update(users)
        .set({ deletedAt: ago(YEAR_MS) })
        .where(eq(users.id, account.id))
      return { docId: doc.id, key }
    }

    const docExists = async (id: string) =>
      (await db.select({ id: legalDocuments.id }).from(legalDocuments).where(eq(legalDocuments.id, id))).length > 0
    const fileExists = (key: string) =>
      storage.getBytes(key).then(
        () => true,
        () => false,
      )

    it("go 10 years after the last verification, files included", async () => {
      const expired = await deletedAccountWithDocument(ago(11 * YEAR_MS))
      const recent = await deletedAccountWithDocument(ago(5 * YEAR_MS))

      const done = await purgeInactiveAccounts(now)

      expect(done.keptDocumentsPurged).toBeGreaterThanOrEqual(1)
      expect(await docExists(expired.docId)).toBe(false)
      expect(await fileExists(expired.key)).toBe(false)
      expect(await docExists(recent.docId)).toBe(true)
      expect(await fileExists(recent.key)).toBe(true)
    })
  })
})
