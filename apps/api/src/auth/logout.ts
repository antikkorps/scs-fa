import { logoutSchema } from "@armurier/shared"
import type { FastifyPluginAsync } from "fastify"
import { findRefreshTokenByHash, revokeRefreshFamily } from "./tokens.js"

export const logoutRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post("/logout", async (request, reply) => {
    const parsed = logoutSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: "ValidationError",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      })
    }

    // Revoke the whole session family, not just this token, so no rotated
    // sibling survives a logout.
    const stored = await findRefreshTokenByHash(parsed.data.refreshToken)
    if (stored) await revokeRefreshFamily(stored.familyId)
    return reply.code(204).send()
  })
}
