import { CURRENT_RGPD_CONSENT_VERSION, registerSchema } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import type { FastifyPluginAsync } from "fastify"
import { db } from "../db/client.js"
import { isUniqueViolation } from "../db/errors.js"
import { auditLogs, users } from "../db/schema.js"

const ARGON2ID_OPTIONS = {
  memoryCost: 19_456, // 19 MiB — OWASP 2024 minimum for argon2id
  timeCost: 2,
  parallelism: 1,
}

export const registerRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/register",
    {
      config: {
        rateLimit: { max: 5, timeWindow: "1 minute" },
      },
    },
    async (request, reply) => {
      const parsed = registerSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({
          error: "ValidationError",
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        })
      }

      const { email, password, firstName, lastName, phone } = parsed.data
      const normalizedEmail = email.trim().toLowerCase()
      const passwordHash = await hash(password, ARGON2ID_OPTIONS)

      try {
        const [created] = await db
          .insert(users)
          .values({
            email: normalizedEmail,
            passwordHash,
            firstname: firstName,
            lastname: lastName,
            phone: phone ?? null,
            role: "customer",
            rgpdConsentAt: new Date(),
            rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
          })
          .returning({
            id: users.id,
            email: users.email,
            firstname: users.firstname,
            lastname: users.lastname,
            role: users.role,
            createdAt: users.createdAt,
          })

        await db.insert(auditLogs).values({
          userId: created.id,
          userRole: created.role,
          entityType: "user",
          entityId: created.id,
          action: "user.registered",
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        })

        return reply.code(201).send({
          id: created.id,
          email: created.email,
          firstName: created.firstname,
          lastName: created.lastname,
          role: created.role,
          createdAt: created.createdAt,
        })
      } catch (err) {
        if (isUniqueViolation(err)) {
          return reply.code(409).send({
            error: "EmailAlreadyRegistered",
            message: "An account with this email already exists",
          })
        }
        request.log.error({ err }, "register: unexpected error")
        return reply.code(500).send({ error: "InternalServerError" })
      }
    },
  )
}
