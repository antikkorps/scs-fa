import { and, eq, isNotNull } from "drizzle-orm"
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

  // Story 12.11 — an access token outlives a deletion by up to an hour: a
  // deleted account's session stops at once, not when its token expires.
  const [deleted] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, request.user.sub), isNotNull(users.deletedAt)))
    .limit(1)
  if (deleted) return reply.code(401).send(UNAUTHORIZED)
}
