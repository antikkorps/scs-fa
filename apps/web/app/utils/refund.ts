// The admin refund form (story 12.6): what kind of refund, what it sends, and
// how it reads a refusal.

export interface RefundFailure {
  message: string
  /** Amounts the admin can pick instead, when the exact one cannot be invoiced. */
  suggestions: number[]
}

interface RefundErrorBody {
  error?: string
  message?: string
  suggestions?: { below: number | null; above: number | null }
}

const INEXPRESSIBLE_MESSAGE =
  "La facturation ne peut pas émettre d'avoir de ce montant exact (arrondi de la TVA). Choisissez un montant proche :"

const REFUSALS: Record<string, string> = {
  ExceedsInvoice: "Les avoirs dépasseraient le montant de la facture.",
  ExceedsOverpayment: "Le montant dépasse le trop-perçu restant.",
  ReturnExceedsOrder: "Plus d'articles que la commande n'en compte, ou qu'il n'en reste à retourner.",
  ShippingAlreadyRefunded: "Les frais de port ont déjà été remboursés.",
  NothingToReturn: "Choisissez au moins un article, ou les frais de port.",
  ReturnNeedsSnapshot: "Commande antérieure à la facturation ligne à ligne : la rembourser par un geste commercial.",
}

export function refundFailure(err: unknown): RefundFailure {
  const body = (err as { data?: RefundErrorBody } | null)?.data
  if (body?.error === "InexpressibleRefundAmount" && body.suggestions) {
    const { below, above } = body.suggestions
    const suggestions = [below, above].filter((amount): amount is number => amount !== null)
    return { message: INEXPRESSIBLE_MESSAGE, suggestions }
  }
  const known = body?.error ? REFUSALS[body.error] : undefined
  return { message: known ?? body?.message ?? "Le remboursement a échoué.", suggestions: [] }
}

// Decisions 2026-10-14: a goods return credits the articles that came back at
// their own VAT rate; a goodwill gesture is an amount; an overpayment refund
// returns money paid in excess, by transfer, without a credit note.
export type RefundKind = "goods_return" | "goodwill" | "overpayment"

export const REFUND_KIND_OPTIONS: Array<{ value: RefundKind; label: string }> = [
  { value: "goods_return", label: "Retour d'articles" },
  { value: "goodwill", label: "Geste commercial" },
  { value: "overpayment", label: "Trop-perçu (virement)" },
]

interface PastRefund {
  kind: RefundKind
  status: string
  lines: Array<{ item: number; qty: number }> | null
  includesShipping: boolean
}

// Refunds that hold money count; failed or cancelled ones gave nothing back.
const COUNTED_STATUSES = ["pending", "succeeded"]

function counted(refunds: PastRefund[]): PastRefund[] {
  return refunds.filter((refund) => COUNTED_STATUSES.includes(refund.status))
}

/** How many of each article (order snapshot order) can still be returned. */
export function returnableQuantities(items: Array<{ qty: number }>, refunds: PastRefund[]): number[] {
  const returned = items.map(() => 0)
  for (const refund of counted(refunds)) {
    for (const line of refund.lines ?? []) returned[line.item] = (returned[line.item] ?? 0) + line.qty
  }
  return items.map((item, index) => Math.max(item.qty - (returned[index] ?? 0), 0))
}

export function shippingRefunded(refunds: PastRefund[]): boolean {
  return counted(refunds).some((refund) => refund.includesShipping)
}

export interface RefundForm {
  kind: RefundKind
  channel: "carte" | "virement"
  /** Per article of the order: how many came back (goods return). */
  quantities: number[]
  includesShipping: boolean
  /** Goodwill gesture or overpayment. */
  amount: number | null
  reason: string
}

/** What the form sends to the API for its kind. */
export function refundRequestBody(form: RefundForm) {
  const reason = form.reason.trim() ? { reason: form.reason.trim() } : {}
  if (form.kind === "goods_return") {
    const lines = form.quantities.flatMap((qty, item) => (qty > 0 ? [{ item, qty }] : []))
    return { kind: form.kind, channel: form.channel, lines, includesShipping: form.includesShipping, ...reason }
  }
  const channel = form.kind === "overpayment" ? "virement" : form.channel
  return { kind: form.kind, channel, amount: form.amount, ...reason }
}
