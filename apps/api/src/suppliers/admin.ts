import { createSupplierSchema, updateSupplierSchema, uuidParamSchema } from "@armurier/shared"
import { asc, count, eq, sql } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import { db } from "../db/client.js"
import { isUniqueViolation } from "../db/errors.js"
import { products, suppliers } from "../db/schema.js"
import { validationError } from "../http.js"

// Shown as-is by the admin form: French, like the import's own messages.
const NAME_TAKEN = {
  error: "Conflict",
  message: "Ce fournisseur existe déjà (majuscules et minuscules ne comptent pas).",
}
const NOT_FOUND = { error: "NotFound", message: "Fournisseur introuvable." }

const SUPPLIER_COLUMNS = {
  id: suppliers.id,
  name: suppliers.name,
  contactEmail: suppliers.contactEmail,
  contactPhone: suppliers.contactPhone,
} as const

/**
 * Suppliers (story 12.5). The catalogue import only accepts a supplier listed
 * here: it used to create one from any unknown name, and a typo made a twin.
 *
 * Names are unique whatever their case — the database enforces it
 * (`uq_suppliers_name_ci`), so a clash is caught at the write, race-free.
 */
export const adminSupplierRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  /** GET / — every supplier, with its product count (archived ones included: they still belong to it). */
  fastify.get("/", async (_request, reply) => {
    const rows = await db
      .select({ ...SUPPLIER_COLUMNS, products: sql<number>`count(${products.id})::int` })
      .from(suppliers)
      .leftJoin(products, eq(products.supplierId, suppliers.id))
      .groupBy(suppliers.id)
      .orderBy(asc(sql`lower(${suppliers.name})`))
    return reply.send({ data: rows })
  })

  fastify.post("/", async (request, reply) => {
    const parsed = createSupplierSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    try {
      const [row] = await db.insert(suppliers).values(parsed.data).returning(SUPPLIER_COLUMNS)
      return reply.code(201).send({ data: { ...row, products: 0 } })
    } catch (error) {
      if (isUniqueViolation(error)) return reply.code(409).send(NAME_TAKEN)
      throw error
    }
  })

  /**
   * PATCH /:id — products point at the supplier's id, so a rename never loses
   * them; only files exported before it still carry the old name.
   */
  fastify.patch("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const parsed = updateSupplierSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    try {
      const [row] = await db
        .update(suppliers)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(suppliers.id, params.data.id))
        .returning(SUPPLIER_COLUMNS)
      if (!row) return reply.code(404).send(NOT_FOUND)
      return reply.send({ data: row })
    } catch (error) {
      if (isUniqueViolation(error)) return reply.code(409).send(NAME_TAKEN)
      throw error
    }
  })

  /** DELETE /:id — only an unused supplier: its products would otherwise lose their round-trip key. */
  fastify.delete("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))

    const [usage] = await db.select({ products: count() }).from(products).where(eq(products.supplierId, params.data.id))
    const linked = usage?.products ?? 0
    if (linked > 0) {
      const noun = linked === 1 ? "1 produit le référence" : `${linked} produits le référencent`
      return reply.code(409).send({
        error: "Conflict",
        message: `Suppression impossible : ${noun} (archivés compris).`,
      })
    }

    const [row] = await db.delete(suppliers).where(eq(suppliers.id, params.data.id)).returning({ id: suppliers.id })
    if (!row) return reply.code(404).send(NOT_FOUND)
    return reply.code(204).send()
  })
}
