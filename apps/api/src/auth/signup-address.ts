// Sign-up without enumeration: whether an address already has an account must
// not show in the answer, nor in its delay. Both sign-up routes answer the same
// thing either way and leave the telling to the mailbox, after the answer.
import { eq } from "drizzle-orm"
import type { FastifyRequest } from "fastify"
import { recordAuditEvent } from "../audit/record.js"
import { db } from "../db/client.js"
import { users } from "../db/schema.js"
import { sendSignupAddressTakenEmail } from "../email.js"

/** The one answer to a sign-up, free address or taken. */
export const CHECK_INBOX = { message: "Check your inbox to continue." } as const

export interface SignupAccount {
  id: string
  role: typeof users.$inferSelect.role
}

/** A pro sign-up also filed a request, which the warning must say was not taken. */
export interface SignupKind {
  pro?: boolean
}

/** `email` must already be normalised (trimmed, lower-cased). */
export async function accountByEmail(email: string): Promise<SignupAccount | undefined> {
  const [account] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)
  return account
}

/** Mails the owner and journals the attempt, each regardless of the other. Never awaited: see the file header. */
export function warnTakenAddress(
  account: SignupAccount,
  email: string,
  request: FastifyRequest,
  options: SignupKind = {},
): void {
  const logFailure = (what: string) => (err: unknown) => request.log.error({ err }, `sign-up: ${what} failed`)

  sendSignupAddressTakenEmail(email, { userId: account.id }, options).catch(logFailure("taken-address e-mail"))
  recordAuditEvent({
    userId: account.id,
    userRole: account.role,
    entityType: "user",
    entityId: account.id,
    action: "user.signup_on_taken_address",
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"] ?? null,
  }).catch(logFailure("taken-address journal"))
}

/**
 * Warns the owner when the address is taken, and says whether it was. Also the
 * way out of a unique violation on insert: a concurrent sign-up won the race.
 */
export async function warnIfTaken(email: string, request: FastifyRequest, options: SignupKind = {}): Promise<boolean> {
  const account = await accountByEmail(email)
  if (!account) return false
  warnTakenAddress(account, email, request, options)
  return true
}
