import { round2 } from "./pricing.js"

// How an order must be paid, depending on what it contains.
export const PAYMENT_SPLIT = {
  VIREMENT_ONLY: "virement_only", // only regulated firearms (bank transfer)
  CARTE_ONLY: "carte_only", // only accessories / Gun Art (card)
  MIXED: "mixed", // both
} as const

export type PaymentSplitType = (typeof PAYMENT_SPLIT)[keyof typeof PAYMENT_SPLIT]

// Payment statuses that count as a completed purchase (e.g. for VIP eligibility).
// A partially-refunded order is still a completed purchase (goods kept, only part
// of the money returned); a fully `refunded` order is not and drops out.
export const PAID_PAYMENT_STATUSES: readonly string[] = ["received", "reconciled", "partially_refunded"]

// The two channels a refund can be issued on, mirroring the payment buckets.
export const REFUND_CHANNELS = ["carte", "virement"] as const
export type RefundChannel = (typeof REFUND_CHANNELS)[number]

// Order status value sets, mirroring the `payment_status` / `order_legal_status`
// Postgres enums exactly. Used by the admin dashboard for filters and status
// tags. (The older ORDER_LEGAL_STATUS / PAYMENT_STATUS constants in constants.ts
// predate the real schema and are not authoritative — prefer these.)
export const ORDER_PAYMENT_STATUSES = [
  "pending",
  "awaiting_transfer",
  "transfer_claimed",
  "received",
  "reconciled",
  "failed",
  "cancelled",
  "partially_refunded",
  "refunded",
] as const
export type OrderPaymentStatus = (typeof ORDER_PAYMENT_STATUSES)[number]

export const ORDER_LEGAL_STATUSES = [
  "pending",
  "docs_verifying",
  "docs_verified",
  "docs_rejected",
  "payment_pending",
  "completed",
] as const
export type OrderLegalStatusValue = (typeof ORDER_LEGAL_STATUSES)[number]

/**
 * Whether an item must be paid by bank transfer (virement) rather than card.
 *
 * Business rule: regulated firearms in legal categories A/B/C require a bank
 * transfer; category D, unregulated ("none") items and Gun Art are payable by
 * card.
 */
export function requiresVirement(legalCategory: string | null | undefined): boolean {
  return legalCategory === "A" || legalCategory === "B" || legalCategory === "C"
}

/**
 * Crockford base32 alphabet — excludes I, L, O and U so the reference is robust
 * to manual transcription (no 1/I, 0/O confusion). The customer copies the
 * reference into their bank's transfer label and the admin matches on it during
 * reconciliation (Story 6.3), so legibility matters more than density.
 */
export const VIREMENT_REF_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

/**
 * Format a bank-transfer payment reference from raw random bytes.
 *
 * Produces `SCS-XXXX-XXXX` (8 Crockford base32 symbols). Pure and injectable:
 * the caller supplies entropy (≥8 bytes) so this stays trivially testable, and
 * uniqueness is enforced by the DB rather than relied upon here.
 */
export function virementReferenceFromBytes(bytes: Uint8Array): string {
  if (bytes.length < 8) {
    throw new Error("virementReferenceFromBytes needs at least 8 bytes of entropy")
  }
  let out = ""
  for (let i = 0; i < 8; i++) {
    // `bytes[i] % 32` is always 0–31 and the alphabet has 32 symbols, so the
    // lookup never misses; the `?? ""` satisfies noUncheckedIndexedAccess.
    out += VIREMENT_REF_ALPHABET[(bytes[i] ?? 0) % 32] ?? ""
  }
  return `SCS-${out.slice(0, 4)}-${out.slice(4)}`
}

/**
 * Matches a bank-transfer reference (`SCS-XXXX-XXXX`, Crockford base32) anywhere
 * inside a free-form bank statement label. Case-insensitive so a bank that
 * upper/lower-cases the label still matches. Story 6.3 reconciliation.
 */
export const VIREMENT_REF_REGEX = new RegExp(`SCS-[${VIREMENT_REF_ALPHABET}]{4}-[${VIREMENT_REF_ALPHABET}]{4}`, "i")

/**
 * Pull our payment reference out of a bank statement label, normalised to the
 * canonical upper-case `SCS-XXXX-XXXX` form, or null when the label carries no
 * recognisable reference. Pure — the DB lookup happens in the service.
 */
export function extractTransferReference(label: string): string | null {
  const match = label.match(VIREMENT_REF_REGEX)
  return match ? match[0].toUpperCase() : null
}

/**
 * Parse a decimal money amount as written by banks, tolerating thousands
 * separators and both comma- and dot-decimal conventions:
 * `"1 234,56"`, `"1,234.56"`, `"1234.56"`, `"+1200,00"` → 1234.56 / 1200.
 * Returns NaN for anything unparseable so callers can reject the row.
 */
export function parseBankAmount(raw: string): number {
  let s = raw.replace(/[\s  ]/g, "").replace(/[€$£]/g, "")
  if (s === "") return Number.NaN
  const lastComma = s.lastIndexOf(",")
  const lastDot = s.lastIndexOf(".")
  if (lastComma !== -1 && lastDot !== -1) {
    // Both present: the right-most is the decimal separator, the other groups.
    const decimalSep = lastComma > lastDot ? "," : "."
    const groupSep = decimalSep === "," ? "." : ","
    s = s.split(groupSep).join("").replace(decimalSep, ".")
  } else if (lastComma !== -1) {
    s = s.replace(",", ".")
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : Number.NaN
}

export interface BankTransaction {
  date: string | null
  label: string
  amount: number
  counterpartyIban: string | null
}

// Header aliases (accent/space-insensitive) for the columns we need from a CSV.
const CSV_HEADER_ALIASES: Record<keyof Omit<BankTransaction, never>, string[]> = {
  date: ["date", "dateoperation", "datedoperation", "datecomptabilisation", "datevaleur"],
  label: ["libelle", "label", "description", "communication", "motif", "intitule", "nature"],
  amount: ["montant", "amount", "credit", "montantcredit", "valeur"],
  counterpartyIban: ["iban", "ibanemetteur", "contrepartie", "counterparty", "compteemetteur"],
}

function normaliseHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "")
}

/** Split one CSV record on `delimiter`, honouring double-quoted fields. */
function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = []
  let field = ""
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      quoted = true
    } else if (c === delimiter) {
      out.push(field)
      field = ""
    } else {
      field += c
    }
  }
  out.push(field)
  return out.map((f) => f.trim())
}

/**
 * Parse a bank statement CSV export into structured transactions.
 *
 * Tolerant by design — French and English banks differ on delimiter (`;` vs
 * `,`), header naming and amount formatting. The header row is matched against
 * known aliases (accent/space-insensitive); `label` and `amount` are required,
 * `date` and `counterpartyIban` optional. Rows whose amount is unparseable are
 * skipped. Throws when no usable header is found so the caller can 400.
 */
export function parseBankStatementCsv(csv: string): BankTransaction[] {
  const lines = csv
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines.length < 2) return []

  // Guarded by the length check above; bind to a non-optional local so the
  // header parsing stays clean under noUncheckedIndexedAccess.
  const headerLine = lines[0] ?? ""
  const delimiter = (headerLine.match(/;/g)?.length ?? 0) >= (headerLine.match(/,/g)?.length ?? 0) ? ";" : ","
  const headers = splitCsvLine(headerLine, delimiter).map(normaliseHeader)

  const indexFor = (key: keyof BankTransaction): number => {
    const aliases = CSV_HEADER_ALIASES[key]
    return headers.findIndex((h) => aliases.includes(h))
  }
  const labelIdx = indexFor("label")
  const amountIdx = indexFor("amount")
  const dateIdx = indexFor("date")
  const ibanIdx = indexFor("counterpartyIban")
  if (labelIdx === -1 || amountIdx === -1) {
    throw new Error("Unrecognised bank statement: a label and an amount column are required")
  }

  const transactions: BankTransaction[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i] ?? "", delimiter)
    const amount = parseBankAmount(cols[amountIdx] ?? "")
    if (Number.isNaN(amount)) continue
    transactions.push({
      date: dateIdx === -1 ? null : (cols[dateIdx] ?? null) || null,
      label: cols[labelIdx] ?? "",
      amount,
      counterpartyIban: ibanIdx === -1 ? null : (cols[ibanIdx]?.replace(/\s/g, "") ?? null) || null,
    })
  }
  return transactions
}

/** True when two money amounts are equal to the cent (avoids float drift). */
export function amountsMatchToCent(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100)
}

export interface PaymentSplitItem {
  priceHt: number
  vatPct: number
  requiresPaymentVirement: boolean
}

export interface PaymentSplit {
  splitType: PaymentSplitType
  virement: { amountHt: number; vat: number; amountTtc: number }
  carte: { amountHt: number; vat: number; amountTtc: number }
}

/** Split order line amounts into a bank-transfer bucket and a card bucket. */
export function calculateOrderPaymentSplit(items: PaymentSplitItem[]): PaymentSplit {
  let virementHt = 0
  let carteHt = 0
  let virementVat = 0
  let carteVat = 0

  for (const item of items) {
    const itemVat = item.priceHt * (item.vatPct / 100)
    if (item.requiresPaymentVirement) {
      virementHt += item.priceHt
      virementVat += itemVat
    } else {
      carteHt += item.priceHt
      carteVat += itemVat
    }
  }

  virementHt = round2(virementHt)
  carteHt = round2(carteHt)
  virementVat = round2(virementVat)
  carteVat = round2(carteVat)

  let splitType: PaymentSplitType
  if (virementHt > 0 && carteHt === 0) {
    splitType = PAYMENT_SPLIT.VIREMENT_ONLY
  } else if (virementHt === 0 && carteHt > 0) {
    splitType = PAYMENT_SPLIT.CARTE_ONLY
  } else {
    splitType = PAYMENT_SPLIT.MIXED
  }

  return {
    splitType,
    virement: {
      amountHt: virementHt,
      vat: virementVat,
      amountTtc: round2(virementHt + virementVat),
    },
    carte: {
      amountHt: carteHt,
      vat: carteVat,
      amountTtc: round2(carteHt + carteVat),
    },
  }
}
