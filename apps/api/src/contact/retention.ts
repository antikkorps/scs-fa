// Audit 2026-11-01 (I8b) — a contact message is kept 1 year after it was
// handled, or 1 year after receipt if nobody ever marked it handled.
import { CONTACT_MESSAGE_RETENTION_YEARS } from "@armurier/shared"
import { and, eq, lt, or } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { startDailyPurge } from "../daily-purge.js"
import { yearsBefore } from "../dates.js"
import { db } from "../db/client.js"
import { contactMessages } from "../db/schema.js"

/** Delete what is past its retention. Idempotent: run it as often as you like. */
export async function purgeContactMessages(now: Date = new Date()): Promise<{ messages: number }> {
  const cutoff = yearsBefore(now, CONTACT_MESSAGE_RETENTION_YEARS)
  const purged = await db
    .delete(contactMessages)
    .where(
      or(
        and(eq(contactMessages.status, "handled"), lt(contactMessages.handledAt, cutoff)),
        and(eq(contactMessages.status, "new"), lt(contactMessages.createdAt, cutoff)),
      ),
    )
    .returning({ id: contactMessages.id })
  return { messages: purged.length }
}

/** Purge at startup, then once a day. */
export function startContactMessagePurge(app: FastifyInstance): void {
  startDailyPurge(app, "contact message", purgeContactMessages)
}
