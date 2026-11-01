// Story 12.11 — accounts for the data-rights suites (export, deletion, purge):
// a customer with a known password, optionally with the authenticator app on,
// and a session token minted directly (the login itself is tested elsewhere).
import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { encryptSecret, generateTotpSecret, totpCode } from "../auth/totp.js"
import { db } from "../db/client.js"
import { auditLogs, orders, users } from "../db/schema.js"
import { env } from "../env.js"

export const ACCOUNT_PASSWORD = "MotDePasseTresLong123!"

const STEP_MS = 30_000

let passwordHash: string | undefined

async function knownPasswordHash(): Promise<string> {
  passwordHash ??= await hash(ACCOUNT_PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
  return passwordHash
}

export interface TestAccount {
  id: string
  email: string
  token: string
  /** The app's code for the current step, when the account has the app on. */
  appCode?: () => string
}

export async function createAccount(
  app: FastifyInstance,
  emailSuffix: string,
  options: { role?: "customer" | "admin"; withApp?: boolean; lastLoginAt?: Date; createdAt?: Date } = {},
): Promise<TestAccount> {
  const role = options.role ?? "customer"
  const secret = options.withApp ? generateTotpSecret() : null
  const [row] = await db
    .insert(users)
    .values({
      email: `${role}-${Date.now()}-${Math.random()}${emailSuffix}`,
      passwordHash: await knownPasswordHash(),
      role,
      firstname: "Jeanne",
      lastname: "Armand",
      phone: "+33612345678",
      addressStreet: "12 rue des Lilas",
      addressPostal: "75011",
      addressCity: "Paris",
      addressCountry: "FR",
      rgpdConsentAt: new Date("2026-01-15T10:00:00Z"),
      rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      ...(secret && { totpSecretEncrypted: encryptSecret(secret, env.TOTP_ENCRYPTION_KEY), totpEnabledAt: new Date() }),
      ...(options.lastLoginAt && { lastLoginAt: options.lastLoginAt }),
      ...(options.createdAt && { createdAt: options.createdAt }),
    })
    .returning({ id: users.id, email: users.email })
  return {
    ...row,
    token: app.jwt.sign({ sub: row.id, role }),
    ...(secret && { appCode: () => totpCode(secret, Math.floor(Date.now() / STEP_MS)) }),
  }
}

/** A minimal order: what the data-rights rules read, defaults for the rest. */
export async function createOrder(
  userId: string,
  values: Partial<typeof orders.$inferInsert> = {},
): Promise<{ id: string }> {
  const [order] = await db
    .insert(orders)
    .values({ userId, subtotalHt: "100.00", vatAmount: "20.00", totalTtc: "120.00", ...values })
    .returning({ id: orders.id })
  return order
}

/** Remove every account of a suite, with what points at it and has no cascade. */
export async function deleteAccounts(emailSuffix: string): Promise<void> {
  const ids = (
    await db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `%${emailSuffix}`))
  ).map((row) => row.id)
  if (ids.length === 0) return
  await db.delete(auditLogs).where(inArray(auditLogs.userId, ids))
  await db.delete(auditLogs).where(inArray(auditLogs.entityId, ids))
  const orderIds = (await db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, ids))).map(
    (row) => row.id,
  )
  if (orderIds.length > 0) {
    await db.delete(auditLogs).where(inArray(auditLogs.orderId, orderIds))
    await db.delete(orders).where(inArray(orders.id, orderIds))
  }
  await db.delete(users).where(inArray(users.id, ids))
}
