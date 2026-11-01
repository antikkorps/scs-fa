// Story 12.8e — the authenticator app from the account: where it stands, its
// setup (QR code, then a first code), the recovery codes regenerated, and
// turning it off (password and code; never for an admin, for whom it is mandatory).

import { totpCodeSchema, totpDisableSchema, totpSetupSchema } from "@armurier/shared"
import { eq } from "drizzle-orm"
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify"
import { recordAuditEvent } from "../audit/record.js"
import { db } from "../db/client.js"
import { users } from "../db/schema.js"
import { validationError } from "../http.js"
import { authenticate } from "./authenticate.js"
import { reauthenticate, sendReauthRefusal } from "./reauth.js"
import {
  beginEnrollment,
  confirmEnrollment,
  regenerateRecoveryCodes,
  remainingRecoveryCodes,
  resetSecondFactor,
  verifySecondFactor,
} from "./two-factor.js"

const INVALID_CODE = { error: "InvalidTotpCode", message: "Invalid code" }

function journal(request: FastifyRequest, user: { id: string; role: string }, action: string) {
  return recordAuditEvent({
    userId: user.id,
    userRole: user.role,
    entityType: "user",
    entityId: user.id,
    action,
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"] ?? null,
  })
}

async function currentUser(request: FastifyRequest) {
  const [user] = await db.select().from(users).where(eq(users.id, request.user.sub)).limit(1)
  return user ?? null
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: "NotFound", message: "Account not found" })
}

export const totpRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)

  fastify.get("/", async (request, reply) => {
    const user = await currentUser(request)
    if (!user) return notFound(reply)
    return reply.send({
      data: {
        enabled: user.totpEnabledAt !== null,
        enabledAt: user.totpEnabledAt,
        required: user.role === "admin",
        recoveryCodesLeft: user.totpEnabledAt ? await remainingRecoveryCodes(user.id) : 0,
      },
    })
  })

  /** POST /setup — a new secret to scan; the app is enabled by the first code (POST /enable). */
  fastify.post("/setup", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = totpSetupSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const current = await currentUser(request)
    if (!current) return notFound(reply)
    if (current.totpEnabledAt) {
      return reply.code(409).send({ error: "TotpAlreadyEnabled", message: "The app is already set up" })
    }
    const reauth = await reauthenticate(current.id, { password: parsed.data.password }, new Date())
    if ("refusal" in reauth) return sendReauthRefusal(reply, reauth.refusal)
    return reply.send({ data: await beginEnrollment(reauth.user) })
  })

  fastify.post("/enable", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = totpCodeSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const user = await currentUser(request)
    if (!user) return notFound(reply)
    const recoveryCodes = await confirmEnrollment(user.id, parsed.data.code, new Date())
    if (!recoveryCodes) return reply.code(400).send(INVALID_CODE)
    await journal(request, user, "user.totp_enabled")
    return reply.send({ data: { recoveryCodes } })
  })

  fastify.post(
    "/recovery-codes",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = totpCodeSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
      const user = await currentUser(request)
      if (!user) return notFound(reply)
      if (!(await verifySecondFactor(user.id, parsed.data.code, new Date()))) {
        return reply.code(400).send(INVALID_CODE)
      }
      const recoveryCodes = await regenerateRecoveryCodes(user.id)
      await journal(request, user, "user.recovery_codes_regenerated")
      return reply.send({ data: { recoveryCodes } })
    },
  )

  fastify.post("/disable", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = totpDisableSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const user = await currentUser(request)
    if (!user) return notFound(reply)
    if (user.role === "admin") {
      return reply.code(403).send({ error: "TotpRequired", message: "The app is mandatory for admin accounts" })
    }
    // Password and code, counted towards the lockout; a wrong password answers
    // 403 so the site shows it instead of going to its login page.
    const reauth = await reauthenticate(user.id, parsed.data, new Date())
    if ("refusal" in reauth) return sendReauthRefusal(reply, reauth.refusal)
    await resetSecondFactor(user.id)
    await journal(request, user, "user.totp_disabled")
    return reply.send({ data: { enabled: false } })
  })
}
