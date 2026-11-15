import { eq, inArray } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, users } from "../db/schema.js"
import { sendAccountDeletedEmail } from "../email.js"
import { createAccount, deleteAccounts } from "../test/account-fixtures.js"
import { eraseAccount } from "./erase.js"
import { purgeUnconfirmedAccounts } from "./unconfirmed.js"

vi.mock("../email.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../email.js")>()),
  sendAccountDeletedEmail: vi.fn().mockResolvedValue(undefined),
}))

const EMAIL_SUFFIX = "@account-unconfirmed.local"
const DAY_MS = 24 * 60 * 60 * 1000

describe("the purge of accounts whose address was never confirmed (audit 2026-11-15, M1)", () => {
  let app: FastifyInstance
  const now = new Date()
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS)
  /** Erased accounts lose the suite's e-mail: their ids are kept for the cleanup. */
  const erasedIds: string[] = []

  const userRow = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0]

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    if (erasedIds.length > 0) {
      await db.delete(auditLogs).where(inArray(auditLogs.entityId, erasedIds))
      await db.delete(users).where(inArray(users.id, erasedIds))
    }
    await deleteAccounts(EMAIL_SUFFIX)
    await app.close()
  })

  it("erases an account left unconfirmed for 7 days, silently, and journals why", async () => {
    const stale = await createAccount(app, EMAIL_SUFFIX, { emailVerified: false, createdAt: daysAgo(8) })
    erasedIds.push(stale.id)

    const result = await purgeUnconfirmedAccounts(now)

    expect(result.erasedAccounts).toBeGreaterThanOrEqual(1)
    const row = await userRow(stale.id)
    expect(row.deletedAt).toBeInstanceOf(Date)
    expect(row.email).not.toBe(stale.email)
    // The address may not even be the signer's: nothing is mailed to it.
    expect(sendAccountDeletedEmail).not.toHaveBeenCalled()
    const events = await db.select().from(auditLogs).where(eq(auditLogs.entityId, stale.id))
    expect(events.find((event) => event.action === "user.deleted")?.newValue).toEqual({ reason: "unconfirmed_email" })
  })

  it("keeps a recent signup, a confirmed address, and an account that already logged in", async () => {
    const recent = await createAccount(app, EMAIL_SUFFIX, { emailVerified: false, createdAt: daysAgo(6) })
    const confirmed = await createAccount(app, EMAIL_SUFFIX, { createdAt: daysAgo(30) })
    // Created before confirmation existed, and used since: not an abandoned signup.
    const used = await createAccount(app, EMAIL_SUFFIX, {
      emailVerified: false,
      createdAt: daysAgo(30),
      lastLoginAt: daysAgo(20),
    })

    await purgeUnconfirmedAccounts(now)

    for (const account of [recent, confirmed, used]) expect((await userRow(account.id)).deletedAt).toBeNull()
  })

  it("re-checks under the lock: an address confirmed after the sweep listed it is spared", async () => {
    // The sweep reads its list, then the owner types their code: the erasure
    // must find the account confirmed and leave it alone.
    const justConfirmed = await createAccount(app, EMAIL_SUFFIX, { createdAt: daysAgo(8) })

    expect(await eraseAccount(justConfirmed.id, now, { onlyIfUnconfirmed: true })).toBeNull()
    expect((await userRow(justConfirmed.id)).deletedAt).toBeNull()
  })

  it("leaves admins and organisation accounts to SCS", async () => {
    const admin = await createAccount(app, EMAIL_SUFFIX, {
      role: "admin",
      emailVerified: false,
      createdAt: daysAgo(30),
    })

    await purgeUnconfirmedAccounts(now)

    expect((await userRow(admin.id)).deletedAt).toBeNull()
  })
})
