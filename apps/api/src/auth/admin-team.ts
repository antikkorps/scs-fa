// Request Franck 2026-11-04 — the back-office's admin team: Fred and Steph
// invite the people who help them, as full admins, and take the access back.
// Every change asks the acting admin's password and code (a stolen session
// alone must not add or remove an admin) and is journaled under their name.
// Removing an access applies at once: the role is read from the account on
// every request (auth/authenticate.ts), and the sessions are closed.

import {
  type AdminTeamMember,
  accountReauthSchema,
  adminInvitationRequestSchema,
  uuidParamSchema,
} from "@armurier/shared"
import { and, asc, eq, gt, isNull, max, sql } from "drizzle-orm"
import type { FastifyPluginAsync, FastifyRequest } from "fastify"
import { recordAuditEvent } from "../audit/record.js"
import { db } from "../db/client.js"
import { loginChallenges, passwordResetTokens, refreshTokens, users } from "../db/schema.js"
import { validationError } from "../http.js"
import { inviteAdmin, NotAnAdminError } from "./admin-invite.js"
import { authenticate } from "./authenticate.js"
import { reauthenticate, sendReauthRefusal } from "./reauth.js"
import { requireRole } from "./require-role.js"

const CHANGE_RATE_LIMIT = { rateLimit: { max: 5, timeWindow: "1 minute" } }

const inviterOf = (request: FastifyRequest) => ({
  id: request.user.sub,
  ipAddress: request.ip,
  userAgent: request.headers["user-agent"] ?? null,
})

export const adminTeamRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  /** GET / — every admin, with where their access stands. */
  fastify.get("/", async (request, reply) => {
    const liveInvitation = db
      .select({ userId: passwordResetTokens.userId, expiresAt: max(passwordResetTokens.expiresAt).as("expires_at") })
      .from(passwordResetTokens)
      .where(and(isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, new Date())))
      .groupBy(passwordResetTokens.userId)
      .as("live_invitation")

    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        firstname: users.firstname,
        lastname: users.lastname,
        totpEnabled: sql<boolean>`${users.totpEnabledAt} is not null`,
        invitationExpiresAt: liveInvitation.expiresAt,
      })
      .from(users)
      .leftJoin(liveInvitation, eq(liveInvitation.userId, users.id))
      .where(and(eq(users.role, "admin"), isNull(users.deletedAt)))
      .orderBy(asc(users.lastname), asc(users.firstname), asc(users.email))

    const data: AdminTeamMember[] = rows.map((row) => ({
      ...row,
      // An enrolled admin's reset link is no invitation.
      invitationExpiresAt: row.totpEnabled || !row.invitationExpiresAt ? null : row.invitationExpiresAt.toISOString(),
      isMe: row.id === request.user.sub,
    }))
    return reply.send({ data })
  })

  /** POST /invitations — a new admin, or a new link for one who has not finished. */
  fastify.post("/invitations", { config: CHANGE_RATE_LIMIT }, async (request, reply) => {
    const parsed = adminInvitationRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const { password, code, ...who } = parsed.data

    const reauth = await reauthenticate(request.user.sub, { password, code }, new Date())
    if ("refusal" in reauth) return sendReauthRefusal(reply, reauth.refusal)

    try {
      const invitation = await inviteAdmin(who, new Date(), inviterOf(request))
      return reply.code(201).send({
        data: {
          email: invitation.email,
          created: invitation.created,
          emailSent: invitation.emailSent,
          // The link is a credential: shown only when the e-mail could not carry it.
          ...(!invitation.emailSent && { link: invitation.link }),
        },
      })
    } catch (error) {
      if (error instanceof NotAnAdminError) {
        return reply
          .code(409)
          .send({ error: "NotAnAdmin", message: "This e-mail belongs to an account that is not an admin" })
      }
      throw error
    }
  })

  /** POST /:id/revoke — the admin becomes a plain account: back-office, sessions and links gone. */
  fastify.post("/:id/revoke", { config: CHANGE_RATE_LIMIT }, async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const confirmation = accountReauthSchema.safeParse(request.body ?? {})
    if (!confirmation.success) return reply.code(400).send(validationError(confirmation.error.issues))
    if (params.data.id === request.user.sub) {
      return reply.code(409).send({ error: "OwnAccount", message: "Another admin removes your own access" })
    }

    const reauth = await reauthenticate(request.user.sub, confirmation.data, new Date())
    if ("refusal" in reauth) return sendReauthRefusal(reply, reauth.refusal)

    const revoked = await db.transaction(async (tx) => {
      const [demoted] = await tx
        .update(users)
        .set({ role: "customer", updatedAt: new Date() })
        .where(and(eq(users.id, params.data.id), eq(users.role, "admin")))
        .returning({ id: users.id })
      if (!demoted) return false
      await tx.delete(refreshTokens).where(eq(refreshTokens.userId, demoted.id))
      await tx.delete(loginChallenges).where(eq(loginChallenges.userId, demoted.id))
      await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordResetTokens.userId, demoted.id), isNull(passwordResetTokens.usedAt)))
      await recordAuditEvent(
        {
          userId: request.user.sub,
          userRole: "admin",
          entityType: "user",
          entityId: demoted.id,
          action: "user.admin_revoked",
          oldValue: { role: "admin" },
          newValue: { role: "customer" },
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        },
        tx,
      )
      return true
    })
    if (!revoked) return reply.code(404).send({ error: "NotFound", message: "No admin with this id" })
    return reply.send({ data: { revoked: true } })
  })
}
