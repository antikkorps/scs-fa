import { CURRENT_RGPD_CONSENT_VERSION, type RegisterInput, registerSchema } from "@armurier/shared"
import type { FastifyPluginAsync, FastifyRequest } from "fastify"
import { recordAuditEvent } from "../audit/record.js"
import { db } from "../db/client.js"
import { isUniqueViolation } from "../db/errors.js"
import { users } from "../db/schema.js"
import { sendSignupWelcomeEmail } from "../email.js"
import { requireShopOpen } from "../shop-settings/require-shop-open.js"
import { hashPassword } from "./password.js"
import { CHECK_INBOX, warnIfTaken } from "./signup-address.js"

/** Inserts the customer and journals it, together or not at all; throws a unique violation when the address is taken. */
async function createCustomer(input: RegisterInput, email: string, passwordHash: string, request: FastifyRequest) {
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(users)
      .values({
        email,
        passwordHash,
        firstname: input.firstName,
        lastname: input.lastName,
        phone: input.phone ?? null,
        role: "customer",
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id, role: users.role })
    if (!created) throw new Error("user insert returned no row")

    await recordAuditEvent(
      {
        userId: created.id,
        userRole: created.role,
        entityType: "user",
        entityId: created.id,
        action: "user.registered",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      },
      tx,
    )
    return created
  })
}

export const registerRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/register",
    {
      preHandler: requireShopOpen,
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

      const email = parsed.data.email.trim().toLowerCase()
      // Hashed even for a taken address: the answer must cost the same either way.
      const passwordHash = await hashPassword(parsed.data.password)
      if (await warnIfTaken(email, request)) return reply.code(202).send(CHECK_INBOX)

      try {
        const created = await createCustomer(parsed.data, email, passwordHash, request)
        sendSignupWelcomeEmail(email, { userId: created.id }).catch((err) => {
          request.log.error({ err }, "register: failed to send the welcome e-mail")
        })
      } catch (err) {
        // Lost the race to a concurrent sign-up: same as a taken address. Any
        // other failure keeps the same answer too: a 500 on the free path alone
        // would tell a free address from a taken one (audit of #275).
        const lostTheRace = isUniqueViolation(err, "users_email_unique") && (await warnIfTaken(email, request))
        if (!lostTheRace) request.log.error({ err }, "register: the account could not be created")
      }
      return reply.code(202).send(CHECK_INBOX)
    },
  )
}
