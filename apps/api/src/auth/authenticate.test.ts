import { randomUUID } from "node:crypto"
import { CURRENT_RGPD_CONSENT_VERSION, type UserRole } from "@armurier/shared"
import { eq, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { users } from "../db/schema.js"

// Review 2026-11-04: an access token lives up to an hour. What it says about
// the account must not outlive a change made in the meantime.

const EMAIL_SUFFIX = "@authenticate-test.local"

describe("authenticate: the account as it stands now, not as the token remembers it", () => {
  let app: FastifyInstance

  async function account(role: UserRole) {
    const [row] = await db
      .insert(users)
      .values({
        email: `${role}-${randomUUID()}${EMAIL_SUFFIX}`,
        passwordHash: "not-used",
        role,
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id })
    return { id: row.id, token: app.jwt.sign({ sub: row.id, role }) }
  }

  const getAdminOrders = (token: string) =>
    app.inject({ method: "GET", url: "/api/admin/orders", headers: { authorization: `Bearer ${token}` } })

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await db.delete(users).where(like(users.email, `%${EMAIL_SUFFIX}`))
    await app.close()
  })

  it("lets an admin in while the account is an admin", async () => {
    const admin = await account("admin")
    expect((await getAdminOrders(admin.token)).statusCode).toBe(200)
  })

  it("shuts a demoted admin out at once, although the token still says admin", async () => {
    const admin = await account("admin")
    await db.update(users).set({ role: "customer" }).where(eq(users.id, admin.id))

    expect((await getAdminOrders(admin.token)).statusCode).toBe(403)
  })

  it("refuses the token of a deleted account", async () => {
    const admin = await account("admin")
    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, admin.id))

    expect((await getAdminOrders(admin.token)).statusCode).toBe(401)
  })

  it("refuses the token of an account that no longer exists", async () => {
    const admin = await account("admin")
    await db.delete(users).where(eq(users.id, admin.id))

    expect((await getAdminOrders(admin.token)).statusCode).toBe(401)
  })
})
