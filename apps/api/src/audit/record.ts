import type { DbExecutor } from "../artworks/reservation.js"
import { db } from "../db/client.js"
import { auditLogs } from "../db/schema.js"
import { currentReqId } from "./context.js"

export interface AuditEvent {
  action: string
  entityType: string
  entityId?: string | null
  /** The order the event belongs to: it then appears in that order's history. */
  orderId?: string | null
  /** Null when nobody clicked: a webhook, a scheduled job. */
  userId?: string | null
  userRole?: string | null
  oldValue?: unknown
  newValue?: unknown
  reason?: string | null
  result?: "success" | "failure"
  /** A short code (`henrri.Timeout`), never a message: messages can carry personal data. */
  error?: string | null
  /** The SMTP message id of an e-mail (story 12.7c): Brevo's reports name it. */
  messageId?: string | null
  /** Kept only outside an order — an order's history is kept 10 years without them. */
  ipAddress?: string | null
  userAgent?: string | null
}

export const INVALID_ERROR_CODE = "invalid_error_code"

// Letters, digits and `._:-` — no spaces, no `@`: nothing an e-mail or a sentence fits in.
const ERROR_CODE = /^[A-Za-z0-9_.:-]{1,100}$/

function errorCode(error: string | null | undefined): string | null {
  if (!error) return null
  return ERROR_CODE.test(error) ? error : INVALID_ERROR_CODE
}

/**
 * The one way to write an audit event. Pass the transaction when the event
 * belongs to a change made in one, so both commit or neither does.
 */
export async function recordAuditEvent(event: AuditEvent, executor: DbExecutor = db): Promise<void> {
  await recordAuditEvents([event], executor)
}

/** Several events in one insert (a catalogue import archives hundreds of rows). */
export async function recordAuditEvents(events: AuditEvent[], executor: DbExecutor = db): Promise<void> {
  if (events.length === 0) return
  await executor.insert(auditLogs).values(events.map(toRow))
}

function toRow(event: AuditEvent): typeof auditLogs.$inferInsert {
  const orderId = event.orderId ?? null
  return {
    userId: event.userId ?? null,
    userRole: event.userRole ?? null,
    entityType: event.entityType,
    entityId: event.entityId ?? null,
    action: event.action,
    oldValue: event.oldValue,
    newValue: event.newValue,
    reason: event.reason ?? null,
    orderId,
    reqId: currentReqId(),
    result: event.result ?? "success",
    error: errorCode(event.error),
    messageId: event.messageId ?? null,
    ipAddress: orderId ? null : (event.ipAddress ?? null),
    userAgent: orderId ? null : (event.userAgent ?? null),
  }
}

/** The order columns whose changes appear in its history, by the word used in the action. */
const ORDER_STATUS_COLUMNS = {
  payment: "paymentStatus",
  shipping: "shippingStatus",
  legal: "legalVerificationStatus",
} as const

export type OrderStatusKind = keyof typeof ORDER_STATUS_COLUMNS

/**
 * An order moved from one status to another (`order.payment.received`). Recorded
 * as the system: these statuses are derived, and the event that caused the move
 * (a payment, a parcel, a document) sits just before it, with its own actor.
 */
export async function recordOrderStatusChange(
  orderId: string,
  kind: OrderStatusKind,
  change: { from: string | null; to: string },
  executor: DbExecutor = db,
): Promise<void> {
  const column = ORDER_STATUS_COLUMNS[kind]
  await recordAuditEvent(
    {
      userRole: "system",
      entityType: "order",
      entityId: orderId,
      orderId,
      action: `order.${kind}.${change.to}`,
      oldValue: { [column]: change.from },
      newValue: { [column]: change.to },
    },
    executor,
  )
}
