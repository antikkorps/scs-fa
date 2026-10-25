// Story 12.8d — the quote SCS builds on a request: each line priced from the
// public price less a discount, the delivery from the grid or typed by hand,
// a validity date, and SCS's verdict on the organisation's documents. The
// figures are computed the way Henrri will compute them, so the total frozen
// when the quote is sent is the one Henrri issues.

import {
  computeShippingCost,
  DEFAULT_QUOTE_VALIDITY_DAYS,
  discountPctOf,
  parisToday,
  quotedUnitPriceHt,
  quoteTotals,
  requiresVirement,
  round2,
  type ShippableLine,
  type ShippingPortion,
  spreadShippingTtc,
} from "@armurier/shared"
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm"
import type { DbExecutor } from "../artworks/reservation.js"
import { db } from "../db/client.js"
import {
  henrriDocuments,
  legalDocuments,
  orders,
  organisations,
  productCategories,
  products,
  quoteRequestItems,
  quoteRequests,
  users,
} from "../db/schema.js"
import { BILLING_ADDRESS_COLUMNS, billingAddressOf, completeBillingAddress } from "../organisations/service.js"
import { loadShippingRates } from "../shipping-rates/service.js"

const DAY_MS = 24 * 60 * 60 * 1000
// A discount stored on a line fits numeric(5, 2); a price far above the public one does not.
const MAX_STORABLE_PCT = 999.99

/** The calendar day a quote holds until, as stored: that day at midnight UTC. */
export function validityDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`)
}

export function validityDay(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null
}

/** A quote holds through its last day, in Paris. */
export function isQuoteExpired(validUntil: Date | null, today = parisToday()): boolean {
  const day = validityDay(validUntil)
  return day !== null && day < today
}

const QUOTE_IN_FLIGHT = ["pending", "draft"] as const

/** Whether a Henrri quote of the request is on its way: the quote is locked until it is out. */
export async function isQuoteSending(executor: DbExecutor, quoteRequestId: string): Promise<boolean> {
  const [row] = await executor
    .select({ id: henrriDocuments.id })
    .from(henrriDocuments)
    .where(and(eq(henrriDocuments.quoteRequestId, quoteRequestId), inArray(henrriDocuments.status, QUOTE_IN_FLIGHT)))
    .limit(1)
  return row !== undefined
}

interface PricedItem {
  qty: number
  quotedPriceHt: string | null
  vatPct: string
  legalCategory: string | null
  categorySlug: string | null
  parcelCount: number | null
}

/** The lines as the delivery grid reads them, at their quoted prices. */
function shippableLines(items: PricedItem[]): ShippableLine[] {
  return items.map((item) => {
    const vatPct = Number(item.vatPct)
    const netHt = round2(Number(item.quotedPriceHt ?? 0) * item.qty)
    return {
      kind: "product",
      // A product deleted since the request travels as a small parcel: SCS adjusts the delivery.
      categorySlug: item.categorySlug ?? "",
      qty: item.qty,
      parcelCount: item.parcelCount ?? 1,
      vatPct,
      netHt,
      lineTtc: round2(netHt * (1 + vatPct / 100)),
      requiresPaymentVirement: requiresVirement(item.legalCategory),
    }
  })
}

async function pricedItems(executor: DbExecutor, quoteRequestId: string) {
  return executor
    .select({
      id: quoteRequestItems.id,
      qty: quoteRequestItems.qty,
      publicPriceHt: quoteRequestItems.publicPriceHt,
      quotedPriceHt: quoteRequestItems.quotedPriceHt,
      vatPct: quoteRequestItems.vatPct,
      legalCategory: quoteRequestItems.legalCategory,
      categorySlug: productCategories.slug,
      parcelCount: products.parcelCount,
    })
    .from(quoteRequestItems)
    .leftJoin(products, eq(products.id, quoteRequestItems.productId))
    .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
    .where(eq(quoteRequestItems.quoteRequestId, quoteRequestId))
    .orderBy(asc(quoteRequestItems.position))
}

function sumTtc(portions: readonly Pick<ShippingPortion, "amountTtc">[]): number {
  return Math.round(portions.reduce((sum, portion) => sum + portion.amountTtc * 100, 0)) / 100
}

/**
 * The quote's starting point, when SCS takes the request in hand: every line
 * at the public price less the organisation's discount, the grid's delivery,
 * and the default validity.
 */
export async function startQuote(tx: DbExecutor, quoteRequestId: string, discountPct: number): Promise<void> {
  const items = await pricedItems(tx, quoteRequestId)
  for (const item of items) {
    item.quotedPriceHt = quotedUnitPriceHt(Number(item.publicPriceHt), discountPct).toFixed(2)
    await tx
      .update(quoteRequestItems)
      .set({ quotedPriceHt: item.quotedPriceHt, lineDiscountPct: discountPct.toFixed(2) })
      .where(eq(quoteRequestItems.id, item.id))
  }
  const shipping = computeShippingCost(shippableLines(items), await loadShippingRates(tx))
  await tx
    .update(quoteRequests)
    .set({
      shippingPortions: shipping.portions,
      validUntil: validityDate(parisToday(new Date(Date.now() + DEFAULT_QUOTE_VALIDITY_DAYS * DAY_MS))),
    })
    .where(eq(quoteRequests.id, quoteRequestId))
}

export interface QuoteChanges {
  items?: Array<{ id: string; unitPriceHt?: number; discountPct?: number }>
  shippingTtc?: number
  validUntil?: string
  documentsSufficient?: boolean
}

/** A line of the patch that is not one of the request's. */
export class UnknownQuoteLine extends Error {}

/**
 * Applies SCS's changes. A line priced by discount gets the price it gives, a
 * line priced by hand the discount it stands for; the delivery keeps its total
 * unless a new one is typed, split again over the lines as priced now.
 */
export async function applyQuoteChanges(
  tx: DbExecutor,
  quoteRequestId: string,
  changes: QuoteChanges,
  adminId: string,
): Promise<void> {
  const items = await pricedItems(tx, quoteRequestId)
  const byId = new Map(items.map((item) => [item.id, item]))

  for (const change of changes.items ?? []) {
    const item = byId.get(change.id)
    if (!item) throw new UnknownQuoteLine()
    const publicPriceHt = Number(item.publicPriceHt)
    const unitPriceHt = change.unitPriceHt ?? quotedUnitPriceHt(publicPriceHt, change.discountPct ?? 0)
    const discountPct = change.discountPct ?? discountPctOf(publicPriceHt, unitPriceHt)
    const storablePct = discountPct !== null && Math.abs(discountPct) <= MAX_STORABLE_PCT ? discountPct : null
    item.quotedPriceHt = unitPriceHt.toFixed(2)
    await tx
      .update(quoteRequestItems)
      .set({ quotedPriceHt: item.quotedPriceHt, lineDiscountPct: storablePct === null ? null : storablePct.toFixed(2) })
      .where(eq(quoteRequestItems.id, item.id))
  }

  const [request] = await tx
    .select({ shippingPortions: quoteRequests.shippingPortions })
    .from(quoteRequests)
    .where(eq(quoteRequests.id, quoteRequestId))
  const shippingTtc = changes.shippingTtc ?? sumTtc(request?.shippingPortions ?? [])
  const repriced = changes.items !== undefined || changes.shippingTtc !== undefined

  await tx
    .update(quoteRequests)
    .set({
      ...(repriced && { shippingPortions: spreadShippingTtc(shippingTtc, shippableLines(items)) }),
      ...(changes.validUntil !== undefined && { validUntil: validityDate(changes.validUntil) }),
      ...(changes.documentsSufficient !== undefined &&
        (changes.documentsSufficient
          ? { documentsSufficientAt: new Date(), documentsSufficientBy: adminId }
          : { documentsSufficientAt: null, documentsSufficientBy: null })),
      updatedAt: new Date(),
    })
    .where(eq(quoteRequests.id, quoteRequestId))
}

/** The quote's total TTC as Henrri will compute it, or null while a line is unpriced. */
export async function quoteTotalOf(executor: DbExecutor, quoteRequestId: string): Promise<number | null> {
  const [request] = await executor
    .select({ shippingPortions: quoteRequests.shippingPortions })
    .from(quoteRequests)
    .where(eq(quoteRequests.id, quoteRequestId))
  const items = await pricedItems(executor, quoteRequestId)
  if (items.some((item) => item.quotedPriceHt === null)) return null
  return quoteTotals(
    items.map((item) => ({ qty: item.qty, unitPriceHt: Number(item.quotedPriceHt), vatPct: Number(item.vatPct) })),
    request?.shippingPortions ?? [],
  ).totalTtc
}

const amount = (value: string | null) => (value === null ? null : Number(value))
const REGULATED_CATEGORIES = new Set(["A", "B", "C"])

/** The request and its quote, as the back-office edits it. */
export async function adminQuoteView(quoteRequestId: string) {
  const [row] = await db
    .select({
      request: quoteRequests,
      organisation: {
        id: organisations.id,
        legalName: organisations.legalName,
        siret: organisations.siret,
        type: organisations.type,
        status: organisations.status,
        discountPct: organisations.discountPct,
        net30Allowed: organisations.net30Allowed,
        showPrices: organisations.showPrices,
      },
      billing: BILLING_ADDRESS_COLUMNS,
      requester: { id: users.id, email: users.email, firstName: users.firstname, lastName: users.lastname },
    })
    .from(quoteRequests)
    .innerJoin(organisations, eq(organisations.id, quoteRequests.organisationId))
    .innerJoin(users, eq(users.id, quoteRequests.requestedBy))
    .where(eq(quoteRequests.id, quoteRequestId))
  if (!row) return null
  const { request } = row

  const [items, [henrri], organisationDocuments] = await Promise.all([
    db
      .select()
      .from(quoteRequestItems)
      .where(eq(quoteRequestItems.quoteRequestId, quoteRequestId))
      .orderBy(asc(quoteRequestItems.position)),
    db
      .select({
        status: henrriDocuments.status,
        number: henrriDocuments.henrriNumber,
        lastError: henrriDocuments.lastError,
        finalizedAt: henrriDocuments.finalizedAt,
      })
      .from(henrriDocuments)
      .where(eq(henrriDocuments.quoteRequestId, quoteRequestId))
      .orderBy(desc(henrriDocuments.createdAt))
      .limit(1),
    // Story 12.8d-2 — what SCS judges "sufficient" on: the organisation's documents.
    db
      .select({
        id: legalDocuments.id,
        docType: legalDocuments.docType,
        verificationStatus: legalDocuments.verificationStatus,
        expiresAt: legalDocuments.expiresAt,
      })
      .from(legalDocuments)
      .where(eq(legalDocuments.organisationId, request.organisationId))
      .orderBy(desc(legalDocuments.uploadedAt)),
  ])

  const shippingPortions = request.shippingPortions ?? []
  const priced = items.every((item) => item.quotedPriceHt !== null)
  const totals = priced
    ? quoteTotals(
        items.map((item) => ({ qty: item.qty, unitPriceHt: Number(item.quotedPriceHt), vatPct: Number(item.vatPct) })),
        shippingPortions,
      )
    : null

  return {
    id: request.id,
    number: request.number,
    status: request.status,
    message: request.message,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    sentAt: request.sentAt,
    validUntil: validityDay(request.validUntil),
    shippingTtc: sumTtc(shippingPortions),
    totals: totals && { totalHt: totals.totalHt, vatAmount: totals.vatAmount, totalTtc: totals.totalTtc },
    totalTtc: amount(request.totalTtc),
    requiresDocuments: items.some(
      (item) => item.legalCategory !== null && REGULATED_CATEGORIES.has(item.legalCategory),
    ),
    documentsSufficient:
      request.documentsSufficientAt && request.documentsSufficientBy
        ? { at: request.documentsSufficientAt, by: request.documentsSufficientBy }
        : null,
    henrri: henrri ?? null,
    sending: henrri !== undefined && (QUOTE_IN_FLIGHT as readonly string[]).includes(henrri.status),
    organisation: {
      ...row.organisation,
      discountPct: Number(row.organisation.discountPct),
      billingAddress: billingAddressOf(row.billing),
      billingAddressComplete: completeBillingAddress(row.billing) !== null,
    },
    requester: row.requester,
    organisationDocuments,
    items: items.map((item) => ({
      ...item,
      publicPriceHt: Number(item.publicPriceHt),
      vatPct: Number(item.vatPct),
      quotedPriceHt: amount(item.quotedPriceHt),
      lineDiscountPct: amount(item.lineDiscountPct),
    })),
  }
}

/** Freezes the total the Henrri quote must match. */
export async function freezeQuoteTotal(tx: DbExecutor, quoteRequestId: string, totalTtc: number) {
  await tx
    .update(quoteRequests)
    .set({ totalTtc: totalTtc.toFixed(2), updatedAt: new Date() })
    .where(eq(quoteRequests.id, quoteRequestId))
}

/** The statuses in which the pro sees the quote: Henrri has issued it. */
const ISSUED_QUOTE_STATUSES = new Set(["sent", "accepted", "declined", "expired", "converted"])

/** The request's issued Henrri quote: the latest one finalized. */
export async function issuedQuotation(quoteRequestId: string) {
  const [document] = await db
    .select({
      henrriDocumentId: henrriDocuments.henrriDocumentId,
      number: henrriDocuments.henrriNumber,
      issuedAt: henrriDocuments.finalizedAt,
    })
    .from(henrriDocuments)
    .where(and(eq(henrriDocuments.quoteRequestId, quoteRequestId), eq(henrriDocuments.status, "finalized")))
    .orderBy(desc(henrriDocuments.finalizedAt))
    .limit(1)
  if (!document?.henrriDocumentId || !document.number) return null
  return { henrriDocumentId: document.henrriDocumentId, number: document.number, issuedAt: document.issuedAt }
}

/**
 * What the pro sees of the quote once Henrri has issued it — never before:
 * the prices SCS is still working on, and the public prices it starts from,
 * stay in the back-office.
 */
export async function memberQuoteView(request: {
  id: string
  status: string
  validUntil: Date | null
  shippingPortions: readonly Pick<ShippingPortion, "amountTtc" | "priceHt" | "vatPct">[] | null
  documentsSufficientAt: Date | null
  organisationId: string
}) {
  if (!ISSUED_QUOTE_STATUSES.has(request.status)) return null
  const quotation = await issuedQuotation(request.id)
  if (!quotation) return null
  const [items, [organisation], [liveOrder]] = await Promise.all([
    db
      .select({
        id: quoteRequestItems.id,
        qty: quoteRequestItems.qty,
        quotedPriceHt: quoteRequestItems.quotedPriceHt,
        vatPct: quoteRequestItems.vatPct,
        legalCategory: quoteRequestItems.legalCategory,
      })
      .from(quoteRequestItems)
      .where(eq(quoteRequestItems.quoteRequestId, request.id))
      .orderBy(asc(quoteRequestItems.position)),
    db
      .select({ net30Allowed: organisations.net30Allowed })
      .from(organisations)
      .where(eq(organisations.id, request.organisationId)),
    db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.quoteRequestId, request.id), ne(orders.paymentStatus, "cancelled")))
      .limit(1),
  ])
  const regulated = items.some((item) => item.legalCategory !== null && REGULATED_CATEGORIES.has(item.legalCategory))
  const refusal = acceptanceRefusal(request, regulated)
  const lines = items.map((item) => ({
    ...item,
    unitPriceHt: Number(item.quotedPriceHt ?? 0),
    vatPct: Number(item.vatPct),
  }))
  const shipping = request.shippingPortions ?? []
  const totals = quoteTotals(lines, shipping)
  return {
    number: quotation.number,
    issuedAt: quotation.issuedAt,
    validUntil: validityDay(request.validUntil),
    items: lines.map((line) => ({
      id: line.id,
      qty: line.qty,
      unitPriceHt: line.unitPriceHt,
      lineHt: round2(line.unitPriceHt * line.qty),
    })),
    shippingTtc: sumTtc(shipping),
    totals: { totalHt: totals.totalHt, vatAmount: totals.vatAmount, totalTtc: totals.totalTtc },
    // Story 12.8d-2 — what the pro needs to accept it, and the order once accepted.
    acceptable: request.status === "sent" && refusal === null,
    refusal,
    net30: organisation?.net30Allowed === true,
    orderId: liveOrder?.id ?? null,
  }
}

/** Why a quote cannot be accepted now, as the acceptance would refuse it; null when it can (or is done). */
function acceptanceRefusal(
  request: { status: string; validUntil: Date | null; documentsSufficientAt: Date | null },
  regulated: boolean,
): "QuoteExpired" | "DocumentsRequired" | null {
  if (request.status === "expired") return "QuoteExpired"
  if (request.status !== "sent") return null
  if (isQuoteExpired(request.validUntil)) return "QuoteExpired"
  if (regulated && !request.documentsSufficientAt) return "DocumentsRequired"
  return null
}
