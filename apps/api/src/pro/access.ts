import { eq } from "drizzle-orm"
import type { FastifyReply, FastifyRequest } from "fastify"
import { db } from "../db/client.js"
import { organisations, users } from "../db/schema.js"

/** The approved organisation a pro route acts for, and its terms. */
export interface ProOrganisation {
  id: string
  legalName: string
  discountPct: number
  showPrices: boolean
}

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `requireApprovedPro`. */
    proOrganisation?: ProOrganisation
  }
}

/**
 * preHandler of every pro route (story 12.8c), after `authenticate`: only the
 * member of an approved organisation passes. Read from the database on each
 * call, so a suspension takes effect at once, whatever the access token says.
 */
export async function requireApprovedPro(request: FastifyRequest, reply: FastifyReply) {
  const [row] = await db
    .select({
      role: users.role,
      id: organisations.id,
      legalName: organisations.legalName,
      status: organisations.status,
      discountPct: organisations.discountPct,
      showPrices: organisations.showPrices,
    })
    .from(users)
    .leftJoin(organisations, eq(organisations.id, users.organisationId))
    .where(eq(users.id, request.user.sub))

  if (row?.role !== "customer" || !row.id || row.status !== "approved") {
    return reply.code(403).send({
      error: "ProAccessRequired",
      message: "Reserved to the members of an approved pro account",
      organisationStatus: row?.status ?? null,
    })
  }
  request.proOrganisation = {
    id: row.id,
    legalName: row.legalName as string,
    discountPct: Number(row.discountPct),
    showPrices: row.showPrices === true,
  }
}

/** The organisation set by `requireApprovedPro`; a route without it is a wiring mistake. */
export function proOrganisationOf(request: FastifyRequest): ProOrganisation {
  if (!request.proOrganisation) throw new Error("requireApprovedPro did not run")
  return request.proOrganisation
}
