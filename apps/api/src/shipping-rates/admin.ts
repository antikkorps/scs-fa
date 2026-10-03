import { shippingRatesSchema } from "@armurier/shared"
import type { FastifyPluginAsync } from "fastify"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import { db } from "../db/client.js"
import { auditLogs, shippingRates } from "../db/schema.js"
import { validationError } from "../http.js"
import { loadShippingRates } from "./service.js"

const money = (n: number) => n.toFixed(2)

/** The shipping rate grid (story 12.3): read and replaced whole by an admin. */
export const adminShippingRateRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  fastify.get("/", async (_request, reply) => reply.send({ data: await loadShippingRates() }))

  fastify.put("/", async (request, reply) => {
    const parsed = shippingRatesSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const rates = parsed.data

    await db.transaction(async (tx) => {
      const before = await loadShippingRates(tx)
      const values = {
        firearmParcelTtc: money(rates.firearmParcelTtc),
        smallParcelTtc: money(rates.smallParcelTtc),
        smallParcelFreeFromTtc: rates.smallParcelFreeFromTtc === null ? null : money(rates.smallParcelFreeFromTtc),
        printTtc: money(rates.printTtc),
        updatedAt: new Date(),
      }
      await tx
        .insert(shippingRates)
        .values({ id: 1, ...values })
        .onConflictDoUpdate({ target: shippingRates.id, set: values })
      // A tariff change moves every future order's total: who changed it, and from what, must be traceable.
      await tx.insert(auditLogs).values({
        userId: request.user.sub,
        userRole: "admin",
        entityType: "shipping_rates",
        action: "shipping_rates.updated",
        oldValue: before,
        newValue: rates,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      })
    })

    return reply.send({ data: await loadShippingRates() })
  })
}
