// Audit 2026-11-01 (I8b) — the contact form: a public POST that stores the
// message and tells the shop, and the admins' inbox.
import {
  CONTACT_STATUSES,
  contactMessageSchema,
  contactStatusSchema,
  looksAutomated,
  uuidParamSchema,
} from "@armurier/shared"
import { and, count, desc, eq, gt } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { recordAuditEvent } from "../audit/record.js"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import { db } from "../db/client.js"
import { contactMessages, users } from "../db/schema.js"
import { sendContactMessageAlertEmail } from "../email.js"
import { validationError } from "../http.js"
import { loadShopIdentity } from "../shop-identity/service.js"

const HOUR_MS = 60 * 60 * 1000
/** Per address, whatever the network: one person cannot flood the inbox. */
const MESSAGES_PER_ADDRESS_PER_HOUR = 3

export const contactRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (request, reply) => {
    const parsed = contactMessageSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const input = parsed.data

    // A robot is told it worked: nothing tells it which trap it fell into.
    if (looksAutomated(input)) return reply.code(201).send({ data: { received: true } })

    const [recent] = await db
      .select({ n: count() })
      .from(contactMessages)
      .where(and(eq(contactMessages.email, input.email), gt(contactMessages.createdAt, new Date(Date.now() - HOUR_MS))))
    if ((recent?.n ?? 0) >= MESSAGES_PER_ADDRESS_PER_HOUR) {
      return reply.code(429).send({ error: "TooManyMessages", message: "Too many messages from this address" })
    }

    const [message] = await db
      .insert(contactMessages)
      .values({
        name: input.name,
        email: input.email,
        phone: input.phone,
        subject: input.subject,
        orderReference: input.orderReference,
        message: input.message,
      })
      .returning({ id: contactMessages.id })

    // The shop's contact address, else every admin: a message is never lost
    // because the identity is not filled in yet. Best-effort: it is stored.
    const { email: shopEmail } = await loadShopIdentity()
    const recipients = shopEmail
      ? [shopEmail]
      : (await db.select({ email: users.email }).from(users).where(eq(users.role, "admin"))).map((u) => u.email)
    await sendContactMessageAlertEmail(recipients, {
      id: message.id,
      name: input.name,
      replyTo: input.email,
      phone: input.phone,
      subject: input.subject,
      orderReference: input.orderReference,
      message: input.message,
    }).catch((err) => request.log.error({ err, contactMessageId: message.id }, "contact alert e-mail failed"))

    return reply.code(201).send({ data: { received: true } })
  })
}

export const adminContactRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  fastify.get("/", async (request, reply) => {
    const status = (request.query as { status?: string }).status
    const filter = CONTACT_STATUSES.find((value) => value === status)
    const rows = await db
      .select()
      .from(contactMessages)
      .where(filter ? eq(contactMessages.status, filter) : undefined)
      .orderBy(desc(contactMessages.createdAt))
      .limit(200)
    return reply.send({ data: rows })
  })

  fastify.patch("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const parsed = contactStatusSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const handled = parsed.data.status === "handled"

    const [updated] = await db
      .update(contactMessages)
      .set({
        status: parsed.data.status,
        handledAt: handled ? new Date() : null,
        handledBy: handled ? request.user.sub : null,
      })
      .where(eq(contactMessages.id, params.data.id))
      .returning()
    if (!updated) return reply.code(404).send({ error: "NotFound", message: "Message not found" })

    await recordAuditEvent({
      userId: request.user.sub,
      userRole: "admin",
      entityType: "contact_message",
      entityId: updated.id,
      action: handled ? "contact_message.handled" : "contact_message.reopened",
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    })
    return reply.send({ data: updated })
  })
}
