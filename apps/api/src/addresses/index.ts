import { createAddressSchema, updateAddressSchema, uuidParamSchema } from "@armurier/shared"
import { and, asc, desc, eq, ne } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { authenticate } from "../auth/authenticate.js"
import { db } from "../db/client.js"
import { addresses } from "../db/schema.js"
import { validationError } from "../http.js"

const ADDRESS_FIELDS = {
  id: addresses.id,
  label: addresses.label,
  type: addresses.type,
  firstName: addresses.firstName,
  lastName: addresses.lastName,
  line1: addresses.line1,
  line2: addresses.line2,
  postal: addresses.postal,
  city: addresses.city,
  country: addresses.country,
  phone: addresses.phone,
  isDefault: addresses.isDefault,
  createdAt: addresses.createdAt,
} as const

export const addressRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)

  // GET /api/addresses — the user's address book (default first)
  fastify.get("/", async (request, reply) => {
    const rows = await db
      .select(ADDRESS_FIELDS)
      .from(addresses)
      .where(eq(addresses.userId, request.user.sub))
      .orderBy(desc(addresses.isDefault), asc(addresses.createdAt))
    return reply.code(200).send({ data: rows })
  })

  // POST /api/addresses — add an address (first one, or isDefault:true, becomes the default)
  fastify.post("/", async (request, reply) => {
    const parsed = createAddressSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send(validationError(parsed.error.issues))
    }
    const userId = request.user.sub
    const data = parsed.data

    const created = await db.transaction(async (tx) => {
      const existing = await tx.select({ id: addresses.id }).from(addresses).where(eq(addresses.userId, userId))
      const makeDefault = data.isDefault ?? existing.length === 0

      if (makeDefault && existing.length > 0) {
        await tx.update(addresses).set({ isDefault: false }).where(eq(addresses.userId, userId))
      }

      const [row] = await tx
        .insert(addresses)
        .values({
          userId,
          label: data.label,
          type: data.type,
          firstName: data.firstName,
          lastName: data.lastName,
          line1: data.line1,
          line2: data.line2,
          postal: data.postal,
          city: data.city,
          country: data.country,
          phone: data.phone,
          isDefault: makeDefault,
        })
        .returning(ADDRESS_FIELDS)
      return row
    })

    return reply.code(201).send({ data: created })
  })

  // PATCH /api/addresses/:id — update an address (ownership enforced)
  fastify.patch("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(validationError(params.error.issues))
    }
    const body = updateAddressSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send(validationError(body.error.issues))
    }
    const userId = request.user.sub
    const { id } = params.data

    const [owned] = await db
      .select({ id: addresses.id })
      .from(addresses)
      .where(and(eq(addresses.id, id), eq(addresses.userId, userId)))
      .limit(1)
    if (!owned) {
      return reply.code(404).send({ error: "NotFound", message: "Address not found" })
    }

    const updated = await db.transaction(async (tx) => {
      if (body.data.isDefault === true) {
        await tx
          .update(addresses)
          .set({ isDefault: false })
          .where(and(eq(addresses.userId, userId), ne(addresses.id, id)))
      }
      const [row] = await tx
        .update(addresses)
        .set({ ...body.data, updatedAt: new Date() })
        .where(eq(addresses.id, id))
        .returning(ADDRESS_FIELDS)
      return row
    })

    return reply.code(200).send({ data: updated })
  })

  // DELETE /api/addresses/:id — remove an address (ownership enforced)
  fastify.delete("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(validationError(params.error.issues))
    }
    const deleted = await db
      .delete(addresses)
      .where(and(eq(addresses.id, params.data.id), eq(addresses.userId, request.user.sub)))
      .returning({ id: addresses.id })

    if (deleted.length === 0) {
      return reply.code(404).send({ error: "NotFound", message: "Address not found" })
    }
    return reply.code(204).send()
  })
}
