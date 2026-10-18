import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { inArray, like } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db } from "../db/client.js"
import { auditLogs, orders, users } from "../db/schema.js"
import { purgeAuditLogs } from "./retention.js"

const EMAIL_PREFIX = "audit-retention-"
const NOW = new Date("2026-10-19T03:00:00Z")
const yearsBefore = (years: number, days = 0) => new Date(Date.UTC(2026 - years, 9, 19 - days, 3))

describe("audit retention (story 12.7e)", () => {
  let userId: string

  async function cleanup() {
    const userIds = db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `${EMAIL_PREFIX}%`))
    await db.delete(auditLogs).where(like(auditLogs.action, "retention.%"))
    await db.delete(orders).where(inArray(orders.userId, userIds))
    await db.delete(users).where(like(users.email, `${EMAIL_PREFIX}%`))
  }

  async function orderPlaced(at: Date) {
    const [order] = await db
      .insert(orders)
      .values({ userId, itemsJson: [], subtotalHt: "1.00", vatAmount: "0.20", totalTtc: "1.20", createdAt: at })
      .returning({ id: orders.id })
    return order.id
  }

  async function event(name: string, at: Date, orderId: string | null = null) {
    await db.insert(auditLogs).values({ entityType: "test", action: `retention.${name}`, orderId, createdAt: at })
  }

  const remaining = async () =>
    (await db.select({ action: auditLogs.action }).from(auditLogs).where(like(auditLogs.action, "retention.%")))
      .map((row) => row.action)
      .sort()

  beforeAll(async () => {
    await cleanup()
    const [user] = await db
      .insert(users)
      .values({
        email: `${EMAIL_PREFIX}customer@audit.local`,
        passwordHash: "not-a-real-hash",
        role: "customer",
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id })
    userId = user.id
  })

  afterAll(cleanup)

  it("keeps an order's history 10 years from the order's date, then removes all of it at once", async () => {
    const old = await orderPlaced(yearsBefore(10, 1))
    const recent = await orderPlaced(yearsBefore(10, -1))
    await event("old-order-created", yearsBefore(10, 1), old)
    // A late event of an old order goes with it: the clock is the order's date.
    await event("old-order-late-refund", yearsBefore(9), old)
    await event("recent-order-created", yearsBefore(10, -1), recent)

    const purged = await purgeAuditLogs(NOW)

    expect(await remaining()).toEqual(["retention.recent-order-created"])
    expect(purged.orderEvents).toBe(2)
  })

  it("keeps everything outside an order for 1 year", async () => {
    await event("login-last-year", yearsBefore(1, 1))
    await event("login-this-year", yearsBefore(1, -1))

    const purged = await purgeAuditLogs(NOW)

    expect(await remaining()).toEqual(["retention.login-this-year", "retention.recent-order-created"])
    expect(purged.otherEvents).toBe(1)
  })

  it("treats the events of a deleted order as outside any order", async () => {
    await event("orphan-last-year", yearsBefore(1, 1))
    await purgeAuditLogs(NOW)
    expect(await remaining()).not.toContain("retention.orphan-last-year")
  })
})
