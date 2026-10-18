import { asc, eq } from "drizzle-orm"
import { db } from "../db/client.js"
import { auditLogs, users } from "../db/schema.js"

export type HistoryActorKind = "admin" | "customer" | "vendor" | "system"

export interface OrderHistoryEvent {
  id: string
  createdAt: Date | null
  action: string
  entityType: string
  entityId: string | null
  result: "success" | "failure"
  error: string | null
  reqId: string | null
  actor: { kind: HistoryActorKind; name: string | null }
  oldValue: unknown
  newValue: unknown
}

/**
 * An order's history for the admin (story 12.7b), oldest first. Neither IP nor
 * user-agent: order events never keep them, and the view does not ask.
 */
export async function orderHistory(orderId: string): Promise<OrderHistoryEvent[]> {
  const rows = await db
    .select({
      id: auditLogs.id,
      createdAt: auditLogs.createdAt,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      result: auditLogs.result,
      error: auditLogs.error,
      reqId: auditLogs.reqId,
      oldValue: auditLogs.oldValue,
      newValue: auditLogs.newValue,
      userRole: users.role,
      firstname: users.firstname,
      lastname: users.lastname,
      email: users.email,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.userId))
    .where(eq(auditLogs.orderId, orderId))
    .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id))

  // Who did it: the account when there is one, otherwise the system (webhook, scheduled job).
  return rows.map(({ userRole, firstname, lastname, email, ...event }) => {
    if (!userRole) return { ...event, actor: { kind: "system", name: null } }
    const fullName = [firstname, lastname].filter(Boolean).join(" ")
    return { ...event, actor: { kind: userRole, name: fullName || email } }
  })
}
