// How the admin refund form reads a refused refund (story 12.6).

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

export function refundFailure(err: unknown): RefundFailure {
  const body = (err as { data?: RefundErrorBody } | null)?.data
  if (body?.error === "InexpressibleRefundAmount" && body.suggestions) {
    const { below, above } = body.suggestions
    const suggestions = [below, above].filter((amount): amount is number => amount !== null)
    return { message: INEXPRESSIBLE_MESSAGE, suggestions }
  }
  return { message: body?.message ?? "Le remboursement a échoué.", suggestions: [] }
}
