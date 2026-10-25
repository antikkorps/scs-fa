// Story 12.8a — the second step of a login, for the accounts whose policy asks
// for it (login-code-policy.ts): after the right password, a 6-digit code is
// mailed; the session opens only on that code. Story 12.8e: the same challenge
// may wait for the authenticator app's code instead, or for its enrolment.
//
// A code rather than a magic link: the mail filters of administrations open
// links on their own, which would spend a link before its recipient does, and
// a code can be read on one device and typed on another.

import { createHmac, hkdfSync, randomInt, timingSafeEqual } from "node:crypto"
import { loginCodeResendSchema, loginCodeVerifySchema } from "@armurier/shared"
import { and, eq, gt, isNull, lt, lte, sql } from "drizzle-orm"
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify"
import { recordAuditEvent } from "../audit/record.js"
import { startDailyPurge } from "../daily-purge.js"
import { db } from "../db/client.js"
import { loginChallenges, users } from "../db/schema.js"
import { sendLoginCodeEmail } from "../email.js"
import { env } from "../env.js"
import { clearFailedLogins, countFailedLogin, lockoutRemainingSeconds, MAX_FAILED_ATTEMPTS } from "./lockout.js"
import type { SecondFactor } from "./login-code-policy.js"
import {
  generateRefreshToken as generateChallengeToken,
  hashRefreshToken as hashChallengeToken,
  issueTokens,
} from "./tokens.js"
import { beginEnrollment, confirmEnrollment, type Enrolment, verifySecondFactor } from "./two-factor.js"

export const LOGIN_CODE_TTL_MINUTES = 10
export const LOGIN_CODE_MAX_ATTEMPTS = 5
/** The first code and two more on request. */
export const LOGIN_CODE_MAX_SENDS = 3
const RESEND_AFTER_MS = 60 * 1000
const TTL_MS = LOGIN_CODE_TTL_MINUTES * 60 * 1000
/** A spent or expired challenge is kept a day, for the journal to be explained by. */
const KEEP_AFTER_EXPIRY_MS = 24 * 60 * 60 * 1000

// A key of its own, derived from the JWT secret: no new secret to manage, and
// the JWT key itself never touches a code.
const CODE_KEY = Buffer.from(hkdfSync("sha256", env.JWT_SECRET, "", "scs-firearms login code", 32))

function digestCode(code: string): string {
  return createHmac("sha256", CODE_KEY).update(code).digest("hex")
}

function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0")
}

function sameDigest(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

function validationError(reply: FastifyReply, issues: { path: PropertyKey[]; message: string }[]) {
  return reply.code(400).send({
    error: "ValidationError",
    issues: issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
  })
}

function accountLocked(reply: FastifyReply, retryAfter: number) {
  return reply.code(423).send({
    error: "AccountLocked",
    message: "Too many failed attempts. Try again later.",
    retryAfter,
  })
}

/**
 * Take one of the challenge's attempts, in one statement: requests racing on
 * the same challenge each get their own, and none past the last (story 12.9f).
 */
async function takeAttempt(challengeId: string): Promise<number | null> {
  const [taken] = await db
    .update(loginChallenges)
    .set({ attempts: sql`${loginChallenges.attempts} + 1` })
    .where(
      and(
        eq(loginChallenges.id, challengeId),
        isNull(loginChallenges.consumedAt),
        gt(loginChallenges.expiresAt, new Date()),
        lt(loginChallenges.attempts, LOGIN_CODE_MAX_ATTEMPTS),
      ),
    )
    .returning({ attempts: loginChallenges.attempts })
  return taken?.attempts ?? null
}

/** What a wrong code ended: the account, the challenge, or nothing yet. */
function wrongCodeAction(accountLocked: boolean, challengeSpent: boolean): string {
  if (accountLocked) return "user.login_locked"
  if (challengeSpent) return "user.login_code_exhausted"
  return "user.login_code_failed"
}

function invalidChallenge(reply: FastifyReply) {
  return reply.code(401).send({
    error: "InvalidLoginChallenge",
    message: "This login has expired. Sign in again with your password.",
  })
}

/** A challenge still open: not spent, not expired. */
async function openChallenge(challengeToken: string) {
  const [row] = await db
    .select()
    .from(loginChallenges)
    .where(
      and(
        eq(loginChallenges.tokenHash, hashChallengeToken(challengeToken)),
        isNull(loginChallenges.consumedAt),
        gt(loginChallenges.expiresAt, new Date()),
      ),
    )
    .limit(1)
  return row ?? null
}

export interface LoginChallengeStart {
  codeRequired: true
  method: SecondFactor
  challengeToken: string
  expiresIn: number
  /** The app to enrol (an admin without it): QR code and key to type in. */
  enrollment?: Enrolment
}

/**
 * Called by the login route once the password is right: open a challenge —
 * mailing its code, or waiting for the app's (or its enrolment) — and return
 * what the client needs to ask for it.
 */
export async function startLoginChallenge(
  user: { id: string; email: string },
  deviceLabel: string | null,
  method: SecondFactor = "email_code",
): Promise<LoginChallengeStart> {
  const challengeToken = generateChallengeToken()
  const code = method === "email_code" ? newCode() : null
  await db.insert(loginChallenges).values({
    userId: user.id,
    method,
    tokenHash: hashChallengeToken(challengeToken),
    codeHash: code ? digestCode(code) : null,
    expiresAt: new Date(Date.now() + TTL_MS),
    deviceLabel,
  })
  const start: LoginChallengeStart = { codeRequired: true, method, challengeToken, expiresIn: TTL_MS / 1000 }
  if (code) await sendLoginCodeEmail(user.email, code, LOGIN_CODE_TTL_MINUTES, { userId: user.id })
  if (method === "totp_enrollment") start.enrollment = await beginEnrollment(user)
  return start
}

type ChallengeRow = typeof loginChallenges.$inferSelect

/**
 * Whether the code answers the challenge, and how: the mailed code, the app's
 * code or a recovery code, or the first code of the app being enrolled (which
 * hands out the recovery codes).
 */
async function checkChallengeCode(
  challenge: ChallengeRow,
  code: string,
): Promise<{ method: string; recoveryCodes?: string[] } | null> {
  if (challenge.method === "email_code") {
    return challenge.codeHash && sameDigest(digestCode(code), challenge.codeHash) ? { method: "email_code" } : null
  }
  if (challenge.method === "totp_enrollment") {
    const recoveryCodes = await confirmEnrollment(challenge.userId, code, new Date())
    return recoveryCodes ? { method: "totp_enrollment", recoveryCodes } : null
  }
  const factor = await verifySecondFactor(challenge.userId, code, new Date())
  return factor ? { method: factor } : null
}

function journal(request: FastifyRequest, user: { id: string; role: string }, action: string, newValue?: unknown) {
  return recordAuditEvent({
    userId: user.id,
    userRole: user.role,
    entityType: "user",
    entityId: user.id,
    action,
    newValue,
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"] ?? null,
  })
}

export const loginCodeRoutes: FastifyPluginAsync = async (fastify) => {
  /** POST /api/auth/login/verify — the code: opens the session, as a password-only login would. */
  fastify.post(
    "/login/verify",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = loginCodeVerifySchema.safeParse(request.body)
      if (!parsed.success) return validationError(reply, parsed.error.issues)

      const challenge = await openChallenge(parsed.data.challengeToken)
      if (!challenge) return invalidChallenge(reply)
      const [user] = await db.select().from(users).where(eq(users.id, challenge.userId)).limit(1)
      if (!user) return invalidChallenge(reply)
      const lockedFor = lockoutRemainingSeconds(user)
      if (lockedFor !== null) return accountLocked(reply, lockedFor)

      const attempts = await takeAttempt(challenge.id)
      if (attempts === null) return invalidChallenge(reply)

      const answer = await checkChallengeCode(challenge, parsed.data.code)
      if (!answer) {
        const spent = attempts >= LOGIN_CODE_MAX_ATTEMPTS
        if (spent) {
          await db.update(loginChallenges).set({ consumedAt: new Date() }).where(eq(loginChallenges.id, challenge.id))
        }
        // A wrong code counts against the account too, across all its challenges.
        const account = await countFailedLogin(user.id)
        await journal(request, user, wrongCodeAction(account.locked, spent), {
          attempts,
          accountAttempts: account.attempts,
        })
        return reply.code(401).send({
          error: "InvalidLoginCode",
          message: "Invalid code",
          remainingAttempts: account.locked
            ? 0
            : Math.min(LOGIN_CODE_MAX_ATTEMPTS - attempts, MAX_FAILED_ATTEMPTS - account.attempts),
        })
      }

      // Spend it first, and only if nobody did in between: two requests racing
      // with the same code open one session, not two.
      const [spent] = await db
        .update(loginChallenges)
        .set({ consumedAt: new Date() })
        .where(and(eq(loginChallenges.id, challenge.id), isNull(loginChallenges.consumedAt)))
        .returning({ id: loginChallenges.id })
      if (!spent) return invalidChallenge(reply)

      await clearFailedLogins(user.id)
      const tokens = await issueTokens(fastify, user, challenge.deviceLabel)
      if (answer.recoveryCodes) await journal(request, user, "user.totp_enabled", { at: "login" })
      const method = answer.method === "totp_enrollment" ? "totp" : answer.method
      await journal(request, user, "user.login", { method: `password+${method}` })

      return reply.code(200).send({
        ...tokens,
        user: { id: user.id, email: user.email, firstName: user.firstname, lastName: user.lastname, role: user.role },
        // The app just enrolled: its recovery codes, shown this once.
        ...(answer.recoveryCodes && { recoveryCodes: answer.recoveryCodes }),
      })
    },
  )

  /** POST /api/auth/login/resend — a new code for the same challenge; the previous one stops working. */
  fastify.post(
    "/login/resend",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = loginCodeResendSchema.safeParse(request.body)
      if (!parsed.success) return validationError(reply, parsed.error.issues)

      const challenge = await openChallenge(parsed.data.challengeToken)
      if (!challenge) return invalidChallenge(reply)
      const [user] = await db.select().from(users).where(eq(users.id, challenge.userId)).limit(1)
      if (!user) return invalidChallenge(reply)
      const lockedFor = lockoutRemainingSeconds(user)
      if (lockedFor !== null) return accountLocked(reply, lockedFor)
      // The app makes its own codes (story 12.8e): nothing to send again.
      if (challenge.method !== "email_code") {
        return reply.code(409).send({ error: "NothingToResend", message: "Use the code shown by your app" })
      }

      const now = new Date()
      const code = newCode()
      // The limits are checked by the update itself: of resends racing on the
      // same challenge, one only goes out (story 12.9f).
      const [resent] = await db
        .update(loginChallenges)
        .set({
          codeHash: digestCode(code),
          attempts: 0,
          sendCount: sql`${loginChallenges.sendCount} + 1`,
          lastSentAt: now,
          expiresAt: new Date(now.getTime() + TTL_MS),
        })
        .where(
          and(
            eq(loginChallenges.id, challenge.id),
            isNull(loginChallenges.consumedAt),
            lt(loginChallenges.sendCount, LOGIN_CODE_MAX_SENDS),
            lte(loginChallenges.lastSentAt, new Date(now.getTime() - RESEND_AFTER_MS)),
          ),
        )
        .returning({ sendCount: loginChallenges.sendCount })
      if (!resent) {
        const exhausted = challenge.sendCount >= LOGIN_CODE_MAX_SENDS
        const waitMs = Math.max(challenge.lastSentAt.getTime() + RESEND_AFTER_MS - now.getTime(), 1000)
        return reply.code(429).send({
          error: "LoginCodeResendRefused",
          message: exhausted
            ? "No more codes for this login. Sign in again with your password."
            : "Wait a moment before asking for a new code.",
          retryAfterSeconds: exhausted ? null : Math.ceil(waitMs / 1000),
        })
      }

      await sendLoginCodeEmail(user.email, code, LOGIN_CODE_TTL_MINUTES, { userId: user.id })
      await journal(request, user, "user.login_code_resent", { sendCount: resent.sendCount })

      return reply.code(202).send({ expiresIn: TTL_MS / 1000 })
    },
  )
}

/** Delete challenges a day past their expiry, spent or not (a spent one expires within minutes). Idempotent. */
export async function purgeLoginChallenges(now: Date = new Date()): Promise<{ challenges: number }> {
  const removed = await db
    .delete(loginChallenges)
    .where(lt(loginChallenges.expiresAt, new Date(now.getTime() - KEEP_AFTER_EXPIRY_MS)))
    .returning({ id: loginChallenges.id })
  return { challenges: removed.length }
}

/** Purge at startup, then once a day. */
export function startLoginChallengePurgeScheduler(app: FastifyInstance): void {
  startDailyPurge(app, "login challenge", purgeLoginChallenges)
}
