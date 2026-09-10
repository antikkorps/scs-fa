import {
  createBeneficiarySchema,
  payoutQuerySchema,
  updateBeneficiarySchema,
  updatePayoutSchema,
  uuidParamSchema,
} from "@armurier/shared"
import { and, asc, desc, eq, sql } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import { db } from "../db/client.js"
import { artists, beneficiaries, beneficiaryPayouts, orders, products } from "../db/schema.js"
import { validationError } from "../http.js"

// What each beneficiary is owed and has been paid — counted through joins, not a
// correlated sub-query (a bare column in a raw `sql` fragment binds to the wrong
// table on a single-table query; see story 7.5a).
const DUE_HT = sql<string>`coalesce(sum(${beneficiaryPayouts.amountHt}) filter (where ${beneficiaryPayouts.status} = 'due'), 0)`
const PAID_HT = sql<string>`coalesce(sum(${beneficiaryPayouts.amountHt}) filter (where ${beneficiaryPayouts.status} = 'paid'), 0)`
const PENDING_HT = sql<string>`coalesce(sum(${beneficiaryPayouts.amountHt}) filter (where ${beneficiaryPayouts.status} = 'pending'), 0)`

/**
 * Beneficiaries and what is owed to them (story 11.10).
 *
 * ⚠️ Admin-only, wholesale. Purchase prices, charges, margins and third-party
 * shares are commercial data: no public route exposes any of it.
 */
export const adminPayoutRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  /** GET /beneficiaries — with the running totals, so "who owes what" is one screen. */
  fastify.get("/beneficiaries", async (_request, reply) => {
    const rows = await db
      .select({
        id: beneficiaries.id,
        slug: beneficiaries.slug,
        name: beneficiaries.name,
        kind: beneficiaries.kind,
        defaultSharePct: beneficiaries.defaultSharePct,
        contactEmail: beneficiaries.contactEmail,
        paymentNotes: beneficiaries.paymentNotes,
        active: beneficiaries.active,
        dueHt: DUE_HT,
        paidHt: PAID_HT,
        pendingHt: PENDING_HT,
      })
      .from(beneficiaries)
      .leftJoin(beneficiaryPayouts, eq(beneficiaryPayouts.beneficiaryId, beneficiaries.id))
      .groupBy(beneficiaries.id)
      .orderBy(asc(beneficiaries.name))

    return reply.send({
      data: rows.map((r) => ({
        ...r,
        defaultSharePct: Number(r.defaultSharePct),
        dueHt: Number(r.dueHt),
        paidHt: Number(r.paidHt),
        pendingHt: Number(r.pendingHt),
      })),
    })
  })

  fastify.post("/beneficiaries", async (request, reply) => {
    const parsed = createBeneficiarySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))

    const [clash] = await db
      .select({ id: beneficiaries.id })
      .from(beneficiaries)
      .where(eq(beneficiaries.slug, parsed.data.slug))
      .limit(1)
    if (clash) return reply.code(409).send({ error: "Conflict", message: "Slug already used" })

    const { defaultSharePct, ...rest } = parsed.data
    const [row] = await db
      .insert(beneficiaries)
      .values({ ...rest, defaultSharePct: defaultSharePct.toFixed(2) })
      .returning()
    return reply.code(201).send({ data: row })
  })

  fastify.patch("/beneficiaries/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const parsed = updateBeneficiarySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))

    const { defaultSharePct, ...rest } = parsed.data
    const [row] = await db
      .update(beneficiaries)
      .set({
        ...rest,
        ...(defaultSharePct !== undefined ? { defaultSharePct: defaultSharePct.toFixed(2) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(beneficiaries.id, params.data.id))
      .returning()
    if (!row) return reply.code(404).send({ error: "NotFound", message: "Beneficiary not found" })

    // ⚠️ Deliberately NOT re-pricing existing payouts: their rate was frozen at
    // the sale. Renegotiating today must not rewrite what was owed yesterday.
    return reply.send({ data: row })
  })

  /**
   * DELETE /beneficiaries/:id — refused as soon as anything is owed or was paid.
   *
   * A payout trail is accounting: it must not vanish because someone tidied up a
   * contact. Deactivating is the way to retire a beneficiary.
   */
  fastify.delete("/beneficiaries/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))

    const [used] = await db
      .select({ id: beneficiaryPayouts.id })
      .from(beneficiaryPayouts)
      .where(eq(beneficiaryPayouts.beneficiaryId, params.data.id))
      .limit(1)
    if (used) {
      return reply.code(409).send({
        error: "Conflict",
        message: "This beneficiary appears on a sale — deactivate them instead of deleting them",
      })
    }

    const [row] = await db
      .delete(beneficiaries)
      .where(eq(beneficiaries.id, params.data.id))
      .returning({ id: beneficiaries.id })
    if (!row) return reply.code(404).send({ error: "NotFound", message: "Beneficiary not found" })
    return reply.code(204).send()
  })

  /** GET /payouts — who is owed what, on which sale. */
  fastify.get("/payouts", async (request, reply) => {
    const parsed = payoutQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))

    const filters = [
      parsed.data.beneficiaryId ? eq(beneficiaryPayouts.beneficiaryId, parsed.data.beneficiaryId) : undefined,
      parsed.data.status ? eq(beneficiaryPayouts.status, parsed.data.status) : undefined,
    ].filter(Boolean)

    const rows = await db
      .select({
        id: beneficiaryPayouts.id,
        orderId: beneficiaryPayouts.orderId,
        orderPlacedAt: orders.createdAt,
        beneficiaryId: beneficiaryPayouts.beneficiaryId,
        beneficiaryName: beneficiaries.name,
        label: beneficiaryPayouts.label,
        sharePct: beneficiaryPayouts.sharePct,
        baseHt: beneficiaryPayouts.baseHt,
        amountHt: beneficiaryPayouts.amountHt,
        status: beneficiaryPayouts.status,
        paidAt: beneficiaryPayouts.paidAt,
        paidNotes: beneficiaryPayouts.paidNotes,
        createdAt: beneficiaryPayouts.createdAt,
      })
      .from(beneficiaryPayouts)
      .innerJoin(beneficiaries, eq(beneficiaryPayouts.beneficiaryId, beneficiaries.id))
      .innerJoin(orders, eq(beneficiaryPayouts.orderId, orders.id))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(beneficiaryPayouts.createdAt))
      .limit(500)

    return reply.send({
      data: rows.map((r) => ({
        ...r,
        sharePct: Number(r.sharePct),
        baseHt: Number(r.baseHt),
        amountHt: Number(r.amountHt),
      })),
    })
  })

  /**
   * PATCH /payouts/:id — mark a payout settled (or put it back to due).
   *
   * Only the human decision is patchable: the rate, the basis and the amount
   * were frozen at the sale and are not editable here.
   */
  fastify.patch("/payouts/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const parsed = updatePayoutSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))

    const [existing] = await db
      .select({ status: beneficiaryPayouts.status })
      .from(beneficiaryPayouts)
      .where(eq(beneficiaryPayouts.id, params.data.id))
      .limit(1)
    if (!existing) return reply.code(404).send({ error: "NotFound", message: "Payout not found" })

    // Nothing is owed on a sale that was never paid, or that was refunded.
    if (existing.status === "pending" || existing.status === "cancelled") {
      return reply.code(409).send({
        error: "Conflict",
        message: `A ${existing.status} payout cannot be settled — the sale is not paid, or was refunded`,
      })
    }

    const [row] = await db
      .update(beneficiaryPayouts)
      .set({
        status: parsed.data.status,
        paidNotes: parsed.data.paidNotes,
        paidAt: parsed.data.status === "paid" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(beneficiaryPayouts.id, params.data.id))
      .returning()
    return reply.send({ data: row })
  })

  /** GET /beneficiary-options — the picker for the product and artist forms. */
  fastify.get("/beneficiary-options", async (_request, reply) => {
    const rows = await db
      .select({
        id: beneficiaries.id,
        name: beneficiaries.name,
        kind: beneficiaries.kind,
        defaultSharePct: beneficiaries.defaultSharePct,
      })
      .from(beneficiaries)
      .where(eq(beneficiaries.active, true))
      .orderBy(asc(beneficiaries.name))
    return reply.send({ data: rows.map((r) => ({ ...r, defaultSharePct: Number(r.defaultSharePct) })) })
  })
}

/** Kept for the product/artist screens: which beneficiary an article resolves to. */
export async function beneficiaryOfProduct(productId: string) {
  const [row] = await db
    .select({ id: beneficiaries.id, name: beneficiaries.name, defaultSharePct: beneficiaries.defaultSharePct })
    .from(products)
    .innerJoin(beneficiaries, eq(products.beneficiaryId, beneficiaries.id))
    .where(eq(products.id, productId))
    .limit(1)
  return row ?? null
}

/** Same for an artwork, whose beneficiary comes from its artist. */
export async function beneficiaryOfArtist(artistId: string) {
  const [row] = await db
    .select({ id: beneficiaries.id, name: beneficiaries.name, defaultSharePct: beneficiaries.defaultSharePct })
    .from(artists)
    .innerJoin(beneficiaries, eq(artists.beneficiaryId, beneficiaries.id))
    .where(eq(artists.id, artistId))
    .limit(1)
  return row ?? null
}
