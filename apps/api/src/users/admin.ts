// Back-office account search: an admin finds a customer by name or e-mail to
// reset the authenticator app (auth/admin-two-factor.ts). A short, capped
// result list, never the whole customer base, and no secret leaves the API.

import { ADMIN_USER_SEARCH_LIMIT, adminUserSearchQuerySchema } from "@armurier/shared"
import { and, asc, ilike, isNotNull, isNull, or, sql } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import { db } from "../db/client.js"
import { containsPattern } from "../db/like.js"
import { users } from "../db/schema.js"
import { validationError } from "../http.js"

export const adminUserRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  /** GET /?q= — accounts whose e-mail, first name, last name or full name contains the search. */
  fastify.get("/", async (request, reply) => {
    const parsed = adminUserSearchQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const pattern = containsPattern(parsed.data.q)

    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        firstname: users.firstname,
        lastname: users.lastname,
        role: users.role,
        isPro: isNotNull(users.organisationId),
        totpEnabled: isNotNull(users.totpEnabledAt),
        createdAt: users.createdAt,
      })
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          or(
            ilike(users.email, pattern),
            ilike(users.firstname, pattern),
            ilike(users.lastname, pattern),
            ilike(sql`${users.firstname} || ' ' || ${users.lastname}`, pattern),
          ),
        ),
      )
      .orderBy(asc(users.lastname), asc(users.firstname), asc(users.email))
      .limit(ADMIN_USER_SEARCH_LIMIT)

    return reply.send({ data: rows })
  })
}
