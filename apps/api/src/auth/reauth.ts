// Story 12.11 — proof that the person at the keyboard holds the account, asked
// again before its data leaves (export) or goes (deletion): a stolen session
// alone must not be enough. The password, then the app's code when it is on.
import type { AccountReauthInput } from "@armurier/shared"
import { verify } from "@node-rs/argon2"
import { eq } from "drizzle-orm"
import type { FastifyReply } from "fastify"
import { db } from "../db/client.js"
import { users } from "../db/schema.js"
import { countFailedLogin, lockoutRemainingSeconds } from "./lockout.js"
import { verifySecondFactor } from "./two-factor.js"

type ReauthenticatedUser = typeof users.$inferSelect

const REFUSALS = {
  NotFound: { status: 404, message: "Account not found" },
  // 403, not 401: the session is valid, the confirmation is not — a 401 would
  // send the site to its login page instead of saying the password is wrong.
  InvalidCredentials: { status: 403, message: "Invalid password" },
  TotpCodeRequired: { status: 400, message: "The authenticator app's code is required" },
  InvalidTotpCode: { status: 400, message: "Invalid code" },
  // Same counter and answer as the login (audit 2026-11-01, B1): a stolen
  // session must not buy an endless supply of password guesses.
  AccountLocked: { status: 423, message: "Too many failed attempts. Try again later." },
} as const

export type ReauthRefusal = keyof typeof REFUSALS

export async function reauthenticate(
  userId: string,
  input: AccountReauthInput,
  now: Date,
): Promise<{ user: ReauthenticatedUser } | { refusal: ReauthRefusal }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user || user.deletedAt) return { refusal: "NotFound" }
  if (lockoutRemainingSeconds(user) !== null) return { refusal: "AccountLocked" }
  if (!(await verify(user.passwordHash, input.password))) return failed(user.id, "InvalidCredentials")
  if (user.totpEnabledAt) {
    if (!input.code) return { refusal: "TotpCodeRequired" }
    if (!(await verifySecondFactor(user.id, input.code, now))) return failed(user.id, "InvalidTotpCode")
  }
  return { user }
}

/** A wrong password or code counts towards the lockout; the last one allowed locks. */
async function failed(userId: string, refusal: ReauthRefusal): Promise<{ refusal: ReauthRefusal }> {
  const { locked } = await countFailedLogin(userId)
  return { refusal: locked ? "AccountLocked" : refusal }
}

export function sendReauthRefusal(reply: FastifyReply, refusal: ReauthRefusal) {
  const { status, message } = REFUSALS[refusal]
  return reply.code(status).send({ error: refusal, message })
}
