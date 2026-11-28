import { and, inArray, isNull } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { z } from "zod"
import { recordAuditEvents } from "../audit/record.js"
import { db } from "../db/client.js"
import { products } from "../db/schema.js"
import { validationError } from "../http.js"
import { GENERIC_ONLY } from "./generic-only.js"

// A supplier's whole catalogue fits: Fred's largest file has about 1 800 lines.
const MAX_IDS = 5000

const bulkArchiveSchema = z.object({ ids: z.array(z.uuid()).min(1).max(MAX_IDS) })

/**
 * Archives the listed products in one go, as the single archive does: off sale,
 * kept in the database, one audit event each. Already archived products and
 * those of the dedicated screens (Gun Art, collection) are left alone.
 */
async function archiveProducts(ids: string[], userId: string): Promise<number> {
  const now = new Date()
  return db.transaction(async (tx) => {
    const archived = await tx
      .update(products)
      .set({ archivedAt: now, published: false, updatedAt: now })
      .where(and(inArray(products.id, ids), isNull(products.archivedAt), GENERIC_ONLY))
      .returning({ id: products.id, sku: products.sku })
    const events = archived.map((product) => ({
      userId,
      userRole: "admin",
      entityType: "product",
      entityId: product.id,
      action: "product.archived",
      newValue: { sku: product.sku, source: "admin-bulk" },
    }))
    await recordAuditEvents(events, tx)
    return archived.length
  })
}

/** Story 12.16b — POST /archive; registered under the admin product routes. */
export const adminProductBulkArchiveRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/archive", async (request, reply) => {
    const body = bulkArchiveSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send(validationError(body.error.issues))
    const archived = await archiveProducts(body.data.ids, request.user.sub)
    return reply.send({ data: { archived } })
  })
}
