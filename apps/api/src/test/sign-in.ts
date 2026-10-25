// Story 12.8e — a full login for the suites that need a session, not the login
// itself: the password, then the authenticator app when the account asks for
// it (an admin enrols it on first login). Answers like the plain login call
// did, so `res.json().accessToken` keeps working. A mailed code is left to the
// caller: those suites check it themselves.
import { eq } from "drizzle-orm"
import type { FastifyInstance, LightMyRequestResponse } from "fastify"
import { base32Decode, decryptSecret, totpCode } from "../auth/totp.js"
import { db } from "../db/client.js"
import { users } from "../db/schema.js"
import { env } from "../env.js"

const STEP_MS = 30_000

/** The app's next usable code: never a step already spent (a code serves once). */
async function appCode(email: string): Promise<string> {
  const [user] = await db
    .select({ secret: users.totpSecretEncrypted, lastStep: users.totpLastStep })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
  if (!user?.secret) throw new Error(`no authenticator app for ${email}`)
  const now = Math.floor(Date.now() / STEP_MS)
  const step = user.lastStep !== null && user.lastStep >= now ? user.lastStep + 1 : now
  return totpCode(decryptSecret(user.secret, env.TOTP_ENCRYPTION_KEY), step)
}

export async function signIn(
  app: FastifyInstance,
  payload: { email: string; password: string; deviceLabel?: string },
): Promise<LightMyRequestResponse> {
  const first = await app.inject({ method: "POST", url: "/api/auth/login", payload })
  if (first.statusCode !== 200) return first
  const body = first.json()
  if (!body.codeRequired || body.method === "email_code") return first

  const code =
    body.method === "totp_enrollment"
      ? totpCode(base32Decode(body.enrollment.secret), Math.floor(Date.now() / STEP_MS))
      : await appCode(payload.email)
  return app.inject({
    method: "POST",
    url: "/api/auth/login/verify",
    payload: { challengeToken: body.challengeToken, code },
  })
}
