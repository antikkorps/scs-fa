import { updateProfileSchema } from "@armurier/shared"
import { eq } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { db } from "../db/client.js"
import { auditLogs, users } from "../db/schema.js"
import { authenticate } from "./authenticate.js"

const PUBLIC_FIELDS = {
  id: users.id,
  email: users.email,
  firstName: users.firstname,
  lastName: users.lastname,
  phone: users.phone,
  role: users.role,
  addressStreet: users.addressStreet,
  addressPostal: users.addressPostal,
  addressCity: users.addressCity,
  addressCountry: users.addressCountry,
  createdAt: users.createdAt,
} as const

export const profileRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get("/me", { preHandler: [authenticate] }, async (request, reply) => {
    const { sub } = request.user

    const [user] = await db.select(PUBLIC_FIELDS).from(users).where(eq(users.id, sub)).limit(1)

    if (!user) {
      return reply.code(404).send({
        error: "NotFound",
        message: "User not found",
      })
    }

    return reply.code(200).send(user)
  })

  fastify.patch("/me", { preHandler: [authenticate] }, async (request, reply) => {
    const { sub, role } = request.user

    const parsed = updateProfileSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: "ValidationError",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      })
    }

    const data = parsed.data
    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (data.firstName !== undefined) updates.firstname = data.firstName
    if (data.lastName !== undefined) updates.lastname = data.lastName
    if (data.phone !== undefined) updates.phone = data.phone
    if (data.addressStreet !== undefined) updates.addressStreet = data.addressStreet
    if (data.addressPostal !== undefined) updates.addressPostal = data.addressPostal
    if (data.addressCity !== undefined) updates.addressCity = data.addressCity
    if (data.addressCountry !== undefined) updates.addressCountry = data.addressCountry

    await db.update(users).set(updates).where(eq(users.id, sub))

    await db.insert(auditLogs).values({
      userId: sub,
      userRole: role,
      entityType: "user",
      entityId: sub,
      action: "user.profile_updated",
      newValue: data,
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    })

    const [updated] = await db.select(PUBLIC_FIELDS).from(users).where(eq(users.id, sub)).limit(1)

    return reply.code(200).send(updated)
  })
}
