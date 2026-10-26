// The accounting export of the payouts: what went out to each beneficiary
// between two Paris days, both included. Money out is what the books record, so
// the period is read on the day a payout was marked paid, never on the sale.

import { orderReference, type PayoutPeriodQuery, toCsv } from "@armurier/shared"
import { and, asc, eq, type SQL, sql } from "drizzle-orm"
import { db } from "../db/client.js"
import { beneficiaries, beneficiaryPayouts, henrriDocuments, orders } from "../db/schema.js"

const PARIS_DAY = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris" })
// A UTF-8 byte order mark, so Excel reads the accents right.
const BYTE_ORDER_MARK = "﻿"

const HEADER = [
  "Versé le",
  "Bénéficiaire",
  "Commande",
  "Date de commande",
  "Facture",
  "Article",
  "Base HT",
  "Taux (%)",
  "Montant HT",
  "Note",
]

/** Timestamps are stored in UTC: the Paris calendar day of one. */
const parisDayOf = (column: typeof beneficiaryPayouts.paidAt) =>
  sql`(${column} at time zone 'UTC' at time zone 'Europe/Paris')::date`

/** Paid payouts whose settlement day, in Paris, falls in the period. */
export function paidInPeriod(period: PayoutPeriodQuery): SQL {
  return sql`${beneficiaryPayouts.status} = 'paid' and ${parisDayOf(beneficiaryPayouts.paidAt)} between ${period.from}::date and ${period.to}::date`
}

/** A decimal column as the French accounting figure, `1234,50`. */
const frenchAmount = (value: string) => Number(value).toFixed(2).replace(".", ",")

export async function payoutsExportCsv(period: PayoutPeriodQuery): Promise<string> {
  const filters = [
    paidInPeriod(period),
    period.beneficiaryId ? eq(beneficiaryPayouts.beneficiaryId, period.beneficiaryId) : undefined,
  ]
  const rows = await db
    .select({
      paidAt: beneficiaryPayouts.paidAt,
      beneficiaryName: beneficiaries.name,
      orderId: beneficiaryPayouts.orderId,
      orderPlacedAt: orders.createdAt,
      invoiceNumber: henrriDocuments.henrriNumber,
      label: beneficiaryPayouts.label,
      baseHt: beneficiaryPayouts.baseHt,
      sharePct: beneficiaryPayouts.sharePct,
      amountHt: beneficiaryPayouts.amountHt,
      paidNotes: beneficiaryPayouts.paidNotes,
    })
    .from(beneficiaryPayouts)
    .innerJoin(beneficiaries, eq(beneficiaryPayouts.beneficiaryId, beneficiaries.id))
    .innerJoin(orders, eq(beneficiaryPayouts.orderId, orders.id))
    // One invoice per order at most (uq_henrri_documents_order_invoice).
    .leftJoin(
      henrriDocuments,
      and(eq(henrriDocuments.orderId, beneficiaryPayouts.orderId), eq(henrriDocuments.kind, "invoice")),
    )
    .where(and(...filters))
    .orderBy(asc(beneficiaryPayouts.paidAt), asc(beneficiaries.name))

  const lines = rows.map((row) => [
    row.paidAt ? PARIS_DAY.format(row.paidAt) : "",
    row.beneficiaryName,
    orderReference(row.orderId),
    row.orderPlacedAt ? PARIS_DAY.format(row.orderPlacedAt) : "",
    row.invoiceNumber ?? "",
    row.label,
    frenchAmount(row.baseHt),
    frenchAmount(row.sharePct),
    frenchAmount(row.amountHt),
    row.paidNotes ?? "",
  ])
  return BYTE_ORDER_MARK + toCsv([HEADER, ...lines])
}
