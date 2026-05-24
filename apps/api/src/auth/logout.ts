import { logoutSchema } from "@armurier/shared"
import type { FastifyPluginAsync } from "fastify"
import { revokeRefreshTokenByValue } from "./tokens.js"

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

    await revokeRefreshTokenByValue(parsed.data.refreshToken)
    return reply.code(204).send()
  })
}
