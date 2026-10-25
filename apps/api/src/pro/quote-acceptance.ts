// Story 12.8d-2 — a pro accepts the quote SCS sent: the order is born of it,
// by a path of its own (neither the cart nor the VIP discount), at the quote's
// frozen prices, billed to the organisation. Everything happens in one
// transaction with the request locked: the stock is checked and taken, the
// payment buckets opened, the request converted — or nothing at all.

import {
  type AcceptQuoteInput,
  CURRENT_TERMS_VERSION,
  calculateOrderPaymentSplit,
  isDeliverableAddress,
  quoteTotals,
  requiresVirement,
  round2,
} from "@armurier/shared"
import { and, asc, eq } from "drizzle-orm"
import { recordAuditEvent } from "../audit/record.js"
import { db } from "../db/client.js"
import {
  addresses,
  orders,
  organisations,
  productCategories,
  products,
  quoteRequestItems,
  quoteRequests,
  users,
} from "../db/schema.js"
import {
  ADDRESS_FIELDS,
  decrementVariantStock,
  insertPaymentBuckets,
  OrderError,
  toSnapshot,
} from "../orders/placement.js"
import { BILLING_ADDRESS_COLUMNS, completeBillingAddress } from "../organisations/service.js"
import { createPayoutsForOrder } from "../payouts/service.js"
import { isQuoteExpired } from "./quotes.js"

const REGULATED = new Set(["A", "B", "C"])

export interface Acceptance {
  quoteRequestId: string
  organisationId: string
  userId: string
  ipAddress: string
  input: AcceptQuoteInput
}

/** Accept the quote and place its order; returns the order id or throws an OrderError the route answers. */
export async function acceptQuote(acceptance: Acceptance): Promise<{ orderId: string; totalTtc: number }> {
  const { input, userId } = acceptance
  // A stale version means the terms changed after the page loaded: re-read them (story 12.1).
  if (input.acceptedTermsVersion !== CURRENT_TERMS_VERSION) {
    throw new OrderError(409, "TermsOutdated", "The terms of sale have changed; review and accept the current version")
  }

  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(quoteRequests)
      .where(
        and(
          eq(quoteRequests.id, acceptance.quoteRequestId),
          eq(quoteRequests.organisationId, acceptance.organisationId),
        ),
      )
      .for("update")
    if (!request) throw new OrderError(404, "NotFound", "Quote request not found")
    if (request.status !== "sent") {
      throw new OrderError(409, "InvalidStatusTransition", `Cannot accept a quote whose status is ${request.status}`)
    }
    if (isQuoteExpired(request.validUntil)) {
      throw new OrderError(409, "QuoteExpired", "This quote's validity has passed: ask SCS for a new one")
    }
    if (!request.totalTtc || !request.shippingPortions) {
      throw new OrderError(409, "InvalidStatusTransition", "This quote has not been issued")
    }

    const items = await tx
      .select({
        item: quoteRequestItems,
        categorySlug: productCategories.slug,
      })
      .from(quoteRequestItems)
      .leftJoin(products, eq(products.id, quoteRequestItems.productId))
      .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
      .where(eq(quoteRequestItems.quoteRequestId, request.id))
      .orderBy(asc(quoteRequestItems.position))
    const regulated = items.some(({ item }) => item.legalCategory !== null && REGULATED.has(item.legalCategory))
    if (regulated && !request.documentsSufficientAt) {
      throw new OrderError(
        409,
        "DocumentsRequired",
        "SCS has not yet judged the organisation's documents sufficient for these items",
      )
    }

    const [shipping] = await tx
      .select(ADDRESS_FIELDS)
      .from(addresses)
      .where(and(eq(addresses.id, input.shippingAddressId), eq(addresses.userId, userId)))
      .limit(1)
    if (!shipping) throw new OrderError(404, "NotFound", "Shipping address not found")
    // Metropolitan France, Corsica included (CGV art. 7, story 12.3).
    if (!isDeliverableAddress(shipping)) {
      throw new OrderError(422, "UndeliverableAddress", "We only deliver to metropolitan France, Corsica included")
    }

    const [organisation] = await tx
      .select({ net30Allowed: organisations.net30Allowed, ...BILLING_ADDRESS_COLUMNS })
      .from(organisations)
      .where(eq(organisations.id, acceptance.organisationId))
    const billingAddress = organisation ? completeBillingAddress(organisation) : null
    if (!organisation || !billingAddress) {
      throw new OrderError(409, "MissingBillingAddress", "The organisation has no billing address")
    }
    const [acceptor] = await tx
      .select({ firstName: users.firstname, lastName: users.lastname })
      .from(users)
      .where(eq(users.id, userId))

    const lines = items.map(({ item, categorySlug }) => {
      if (!item.variantId || item.quotedPriceHt === null) {
        throw new OrderError(409, "QuoteLineUnavailable", `${item.productName} can no longer be ordered`)
      }
      return {
        variantId: item.variantId,
        qty: item.qty,
        priceHt: Number(item.quotedPriceHt),
        name: item.variantLabel ? `${item.productName} — ${item.variantLabel}` : item.productName,
        sku: item.productSku,
        category: categorySlug ?? "",
        legalCategory: item.legalCategory,
        vatPct: Number(item.vatPct),
      }
    })

    // The figures are the quote's: recomputed, they must give the frozen total.
    const shippingPortions = request.shippingPortions
    const totals = quoteTotals(
      lines.map((line) => ({ qty: line.qty, unitPriceHt: line.priceHt, vatPct: line.vatPct })),
      shippingPortions,
    )
    if (Math.round(totals.totalTtc * 100) !== Math.round(Number(request.totalTtc) * 100)) {
      throw new OrderError(409, "QuoteChanged", "The quote no longer adds up to its sent total: ask SCS to revise it")
    }

    const net30 = organisation.net30Allowed
    // "On invoice", everything is paid by one transfer after the invoice; otherwise
    // the shop's split: regulated items by transfer, the rest by card.
    const byTransfer = (legalCategory: string | null) => net30 || requiresVirement(legalCategory)
    const split = calculateOrderPaymentSplit([
      ...lines.map((line) => ({
        priceHt: round2(line.priceHt * line.qty),
        vatPct: line.vatPct,
        requiresPaymentVirement: byTransfer(line.legalCategory),
      })),
      ...shippingPortions.map((portion) => ({
        priceHt: portion.priceHt,
        vatPct: portion.vatPct,
        requiresPaymentVirement:
          net30 || (portion as { requiresPaymentVirement?: boolean }).requiresPaymentVirement === true,
      })),
    ])

    const itemsJson = lines.map((line) => ({
      variantId: line.variantId,
      qty: line.qty,
      priceHt: line.priceHt,
      name: line.name,
      sku: line.sku,
      category: line.category,
      legalCategory: line.legalCategory,
      requiresPaymentVirement: byTransfer(line.legalCategory),
      vatPct: line.vatPct,
      discountHt: 0,
    }))
    const shippingTtc = shippingPortions.reduce((sum, portion) => sum + portion.amountTtc, 0)
    const shippingHt = shippingPortions.reduce((sum, portion) => sum + portion.priceHt, 0)
    const shippingSnapshot = toSnapshot(shipping)
    const now = new Date()

    const [order] = await tx
      .insert(orders)
      .values({
        userId,
        quoteRequestId: request.id,
        paymentTerms: net30 ? "net30" : "immediate",
        // SCS judged the organisation's documents on the quote: nothing is left to upload.
        legalVerificationStatus: regulated ? "docs_verified" : "payment_pending",
        legalVerifiedAt: regulated ? request.documentsSufficientAt : null,
        legalVerifiedBy: regulated ? request.documentsSufficientBy : null,
        paymentStatus: "pending",
        termsVersion: input.acceptedTermsVersion,
        termsAcceptedAt: now,
        itemsJson,
        subtotalHt: round2(lines.reduce((sum, line) => sum + line.priceHt * line.qty, 0)).toFixed(2),
        vatAmount: totals.vatAmount.toFixed(2),
        totalTtc: totals.totalTtc.toFixed(2),
        vipDiscountAmount: "0.00",
        vipDiscountAppliedPct: "0.00",
        shippingCost: round2(shippingTtc).toFixed(2),
        shippingHt: round2(shippingHt).toFixed(2),
        shippingPortions: shippingPortions.map(({ amountTtc, priceHt, vatAmount, vatPct }) => ({
          amountTtc,
          priceHt,
          vatAmount,
          vatPct,
        })),
        shippingAddress: shippingSnapshot,
        billingAddress: {
          firstName: acceptor?.firstName ?? "",
          lastName: acceptor?.lastName ?? "",
          ...billingAddress,
          phone: null,
        },
        shippingAddressStreet: shippingSnapshot.line1,
        shippingAddressPostal: shippingSnapshot.postal,
        shippingAddressCity: shippingSnapshot.city,
        chorusServiceCode: input.chorusServiceCode,
        chorusCommitmentNumber: input.chorusCommitmentNumber,
      })
      .returning({ id: orders.id })
    if (!order) throw new Error("order insert returned no row")

    await createPayoutsForOrder(order.id, itemsJson, tx)
    await decrementVariantStock(tx, lines, userId)
    await insertPaymentBuckets(tx, order.id, split)

    await tx
      .update(quoteRequests)
      .set({
        status: "converted",
        acceptedAt: now,
        acceptedBy: userId,
        acceptedIp: acceptance.ipAddress,
        updatedAt: now,
      })
      .where(eq(quoteRequests.id, request.id))
    await recordAuditEvent(
      {
        userId,
        userRole: "customer",
        entityType: "quote_request",
        entityId: request.id,
        orderId: order.id,
        action: "quote_request.accepted",
        oldValue: { status: "sent" },
        newValue: { status: "converted", orderId: order.id, paymentTerms: net30 ? "net30" : "immediate" },
        ipAddress: acceptance.ipAddress,
      },
      tx,
    )
    await recordAuditEvent(
      {
        userId,
        userRole: "customer",
        entityType: "order",
        entityId: order.id,
        orderId: order.id,
        action: "order.created",
        newValue: { totalTtc: totals.totalTtc, splitType: split.splitType, quoteRequestId: request.id },
      },
      tx,
    )
    return { orderId: order.id, totalTtc: totals.totalTtc }
  })
}
