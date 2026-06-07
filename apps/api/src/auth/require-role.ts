import type { UserRole } from "@armurier/shared"
import type { FastifyReply, FastifyRequest } from "fastify"

/**
 * preHandler factory enforcing a role from the (already verified) JWT.
 * Must run after `authenticate` — it reads `request.user`.
 */
export function requireRole(role: UserRole) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.user.role !== role) {
      return reply.code(403).send({
        error: "Forbidden",
        message: "Insufficient permissions",
      })
    }
  }
}
