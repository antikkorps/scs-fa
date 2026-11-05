import { eq } from "drizzle-orm"
import type { FastifyReply, FastifyRequest } from "fastify"
import { db } from "../db/client.js"
import { users } from "../db/schema.js"

const UNAUTHORIZED = { error: "Unauthorized", message: "Valid authentication token required" }

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify()
  } catch {
    return reply.code(401).send(UNAUTHORIZED)
  }

  // An access token lives up to an hour; the account is read again on every
  // request so a change made meanwhile applies at once:
  //  - a deleted (story 12.11) or vanished account's session stops;
  //  - the role comes from the account, not the token, so a demoted admin
  //    loses the back-office straight away (review 2026-11-04).
  const [account] = await db
    .select({ role: users.role, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, request.user.sub))
    .limit(1)
  if (!account || account.deletedAt) return reply.code(401).send(UNAUTHORIZED)
  request.user.role = account.role
}
