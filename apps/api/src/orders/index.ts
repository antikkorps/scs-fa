import {
  CURRENT_TERMS_VERSION,
  calculateOrderPaymentSplit,
  createOrderSchema,
  isDeliverableAddress,
  orderDocumentParamSchema,
  orderPaymentDeadline,
  paginationSchema,
  requiresVirement,
  round2,
  uuidParamSchema,
} from "@armurier/shared"
import { and, desc, eq, sql } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { reservePrintForOrder } from "../artworks/reservation.js"
import { recordAuditEvent } from "../audit/record.js"
import { authenticate } from "../auth/authenticate.js"
import { loadCart, reconcileCart } from "../cart/service.js"
import { db } from "../db/client.js"
import { addresses, artworkCartItems, cartItems, orders, paymentCarte, paymentVirement } from "../db/schema.js"
import { HenrriError } from "../henrri/client.js"
import { issuedDocument, issuedDocumentsOfOrder, pdfFileName } from "../henrri/customer.js"
import { validationError } from "../http.js"
import { createPayoutsForOrder } from "../payouts/service.js"
import { customerShipments } from "../shipments/service.js"
import { requireShopOpen } from "../shop-settings/require-shop-open.js"
import { sendOrderConfirmation } from "./confirmation.js"
import { buildRequiredDocsView, loadUserDocs, recomputeOrderLegalStatus, requiredDocTypesFor } from "./legal-status.js"
import { ADDRESS_FIELDS, decrementVariantStock, insertPaymentBuckets, OrderError, toSnapshot } from "./placement.js"

/**
 * When the customer must have paid. Story 12.9a: past this, an order with no
 * money in is cancelled — a pro order born of a quote gets the transfer's week
 * whatever the means. Story 12.8d: on invoice, 30 days after the invoice
 * issued at dispatch, never cancelled (no date before the dispatch).
 */
function paymentDueDate(
  order: {
    paymentStatus: string
    createdAt: Date | null
    paymentTerms: string
    invoiceDueAt: Date | null
    quoteRequestId: string | null
  },
  hasTransfer: boolean,
): Date | null {
  if (order.paymentStatus !== "pending") return null
  if (order.paymentTerms === "net30") return order.invoiceDueAt
  if (!order.createdAt) return null
  return orderPaymentDeadline(order.createdAt, { hasTransfer: hasTransfer || order.quoteRequestId !== null })
}

export const orderRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)

  // POST /api/orders — turn the user's cart into an order with an automatic payment split
  fastify.post("/", { preHandler: requireShopOpen }, async (request, reply) => {
    const userId = request.user.sub
    const role = request.user.role

    const parsed = createOrderSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send(validationError(parsed.error.issues))
    }
    const { shippingAddressId, billingAddressId, acceptedTermsVersion } = parsed.data

    // The customer must have ticked the CGV in force (story 12.1). A stale
    // version means the text changed after their checkout page loaded: they
    // must re-read it, so the order is refused rather than silently upgraded.
    if (acceptedTermsVersion !== CURRENT_TERMS_VERSION) {
      return reply.code(409).send({
        error: "TermsOutdated",
        message: "The terms of sale have changed; review and accept the current version",
        currentVersion: CURRENT_TERMS_VERSION,
      })
    }

    // Story 12.9d: the cart is re-checked against the catalogue as it is now. A
    // moved price, or an article no longer for sale, refuses the order with the
    // refreshed cart: the customer sees what changed and confirms again.
    const changes = await reconcileCart(userId)
    if (changes.length > 0) {
      return reply.code(409).send({
        error: "CartChanged",
        message: "The cart changed since it was filled; review it and confirm again",
        changes,
        cart: await loadCart(userId),
      })
    }

    const cart = await loadCart(userId)
    if (cart.summary.itemCount === 0) {
      return reply.code(400).send({ error: "EmptyCart", message: "Cart is empty" })
    }

    const [shipping] = await db
      .select(ADDRESS_FIELDS)
      .from(addresses)
      .where(and(eq(addresses.id, shippingAddressId), eq(addresses.userId, userId)))
      .limit(1)
    if (!shipping) {
      return reply.code(404).send({ error: "NotFound", message: "Shipping address not found" })
    }

    let billing = shipping
    if (billingAddressId && billingAddressId !== shippingAddressId) {
      const [b] = await db
        .select(ADDRESS_FIELDS)
        .from(addresses)
        .where(and(eq(addresses.id, billingAddressId), eq(addresses.userId, userId)))
        .limit(1)
      if (!b) {
        return reply.code(404).send({ error: "NotFound", message: "Billing address not found" })
      }
      billing = b
    }

    // The shop delivers to metropolitan France only, Corsica included (CGV art. 7,
    // story 12.3). Checked here, not only in the form: the grid prices nothing else.
    if (!isDeliverableAddress(shipping)) {
      return reply.code(422).send({
        error: "UndeliverableAddress",
        message: "We only deliver to metropolitan France, Corsica included",
      })
    }

    const shippingSnapshot = toSnapshot(shipping)
    const billingSnapshot = toSnapshot(billing)

    // Payment split is computed on the net (VIP-discounted) line amounts. Each
    // shipping slice rides with the line it carries — its VAT rate and bucket.
    const splitItems = [
      ...cart.items.map((l) => ({
        priceHt: round2(l.lineHt - l.discountAmount),
        vatPct: l.vatPct,
        requiresPaymentVirement: requiresVirement(l.legalCategory),
      })),
      ...cart.artworkItems.map((l) => ({
        priceHt: round2(l.lineHt - l.discountAmount),
        vatPct: l.vatPct,
        requiresPaymentVirement: false,
      })),
      ...cart.summary.shipping.portions,
    ]
    const split = calculateOrderPaymentSplit(splitItems)

    const needsLegalVerification = cart.items.some((l) => l.requiresLegalVerification)
    const legalStatus = needsLegalVerification ? "pending" : "payment_pending"

    const itemsJson = [
      ...cart.items.map((l) => ({
        variantId: l.variantId,
        qty: l.qty,
        priceHt: l.unitPriceHt,
        name: l.name,
        sku: l.sku,
        category: l.categorySlug,
        tags: l.tagSlugs,
        legalCategory: l.legalCategory,
        requiresPaymentVirement: requiresVirement(l.legalCategory),
        vatPct: l.vatPct,
        discountHt: l.discountAmount,
      })),
      ...cart.artworkItems.map((l) => ({
        printId: l.printId,
        qty: 1,
        priceHt: l.unitPriceHt,
        name: l.title,
        sku: l.printDesignation,
        category: "gun-art",
        requiresPaymentVirement: false,
        vatPct: l.vatPct,
        discountHt: l.discountAmount,
      })),
    ]
    // The invoice bills the delivery exactly as it was split here (story 12.6).
    const shippingPortions = cart.summary.shipping.portions.map(({ amountTtc, priceHt, vatAmount, vatPct }) => ({
      amountTtc,
      priceHt,
      vatAmount,
      vatPct,
    }))

    let orderId: string
    try {
      orderId = await db.transaction(async (tx) => {
        const [order] = await tx
          .insert(orders)
          .values({
            userId,
            legalVerificationStatus: legalStatus,
            paymentStatus: "pending",
            termsVersion: acceptedTermsVersion,
            termsAcceptedAt: new Date(),
            itemsJson,
            subtotalHt: cart.summary.subtotalHt.toFixed(2),
            vatAmount: cart.summary.vatAmount.toFixed(2),
            totalTtc: cart.summary.totalTtc.toFixed(2),
            vipDiscountAmount: cart.summary.vipDiscountAmount.toFixed(2),
            vipDiscountAppliedPct: (cart.summary.subtotalHt > 0
              ? round2((cart.summary.vipDiscountAmount / cart.summary.subtotalHt) * 100)
              : 0
            ).toFixed(2),
            shippingCost: cart.summary.shipping.totalTtc.toFixed(2),
            shippingHt: cart.summary.shipping.totalHt.toFixed(2),
            shippingPortions,
            shippingAddress: shippingSnapshot,
            billingAddress: billingSnapshot,
            shippingAddressStreet: shippingSnapshot.line1,
            shippingAddressPostal: shippingSnapshot.postal,
            shippingAddressCity: shippingSnapshot.city,
          })
          .returning({ id: orders.id })

        // Freeze what each beneficiary will be owed, at the rates in force TODAY
        // (story 11.10). Created `pending`: nothing is due until the money lands.
        await createPayoutsForOrder(order.id, itemsJson, tx)

        // Decrement variant stock atomically (guard prevents overselling).
        await decrementVariantStock(tx, cart.items, userId)

        // Promote the cart-held prints to this order (in_cart -> reserved)
        for (const line of cart.artworkItems) {
          const reserved = await reservePrintForOrder(line.printId, order.id, tx)
          if (!reserved) {
            throw new OrderError(409, "Conflict", `Print ${line.printDesignation} is no longer available`)
          }
        }

        await insertPaymentBuckets(tx, order.id, split)

        await tx.delete(cartItems).where(eq(cartItems.userId, userId))
        await tx.delete(artworkCartItems).where(eq(artworkCartItems.userId, userId))

        return order.id
      })
    } catch (err) {
      if (err instanceof OrderError) {
        return reply.code(err.statusCode).send({ error: err.errorCode, message: err.message })
      }
      throw err
    }

    await recordAuditEvent({
      userId,
      userRole: role,
      entityType: "order",
      entityId: orderId,
      orderId,
      action: "order.created",
      newValue: {
        totalTtc: cart.summary.totalTtc,
        shippingTtc: cart.summary.shipping.totalTtc,
        splitType: split.splitType,
        termsVersion: acceptedTermsVersion,
      },
    })

    // Confirmation on a durable medium (story 12.1). Not awaited: the customer
    // must not wait on the mail provider, and a failure is retried later
    // (sendOrderConfirmation never throws).
    void sendOrderConfirmation(orderId, request.log)

    return reply.code(201).send({
      data: {
        id: orderId,
        legalVerificationStatus: legalStatus,
        paymentStatus: "pending",
        requiresLegalVerification: needsLegalVerification,
        totals: cart.summary,
        paymentSplit: split,
        shippingAddress: shippingSnapshot,
        billingAddress: billingSnapshot,
      },
    })
  })

  // GET /api/orders — the authenticated user's orders (most recent first)
  fastify.get("/", async (request, reply) => {
    const parsed = paginationSchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send(validationError(parsed.error.issues))
    }
    const { page, limit } = parsed.data
    const userId = request.user.sub

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(orders)
      .where(eq(orders.userId, userId))

    const rows = await db
      .select({
        id: orders.id,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        legalVerificationStatus: orders.legalVerificationStatus,
        paymentStatus: orders.paymentStatus,
        subtotalHt: orders.subtotalHt,
        vatAmount: orders.vatAmount,
        totalTtc: orders.totalTtc,
        itemsJson: orders.itemsJson,
      })
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset((page - 1) * limit)

    const data = rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      legalVerificationStatus: r.legalVerificationStatus,
      paymentStatus: r.paymentStatus,
      subtotalHt: Number(r.subtotalHt),
      vatAmount: Number(r.vatAmount),
      totalTtc: Number(r.totalTtc),
      itemCount: r.itemsJson.reduce((sum, i) => sum + i.qty, 0),
    }))

    return reply.code(200).send({
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    })
  })

  // GET /api/orders/:id/invoices/:documentId/pdf — an invoice or credit note
  // Henrri issued on the customer's order (story 12.6), as Henrri locked it.
  fastify.get("/:id/invoices/:documentId/pdf", async (request, reply) => {
    const params = orderDocumentParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(validationError(params.error.issues))
    }
    const [owned] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.id, params.data.id), eq(orders.userId, request.user.sub)))
      .limit(1)
    const document = owned ? await issuedDocument(owned.id, params.data.documentId) : null
    if (!document) {
      return reply.code(404).send({ error: "NotFound", message: "Invoice not found" })
    }
    const unavailable = () =>
      reply.code(503).send({ error: "InvoiceUnavailable", message: "Invoices cannot be fetched right now" })
    if (!fastify.henrri) return unavailable()

    let pdf: Uint8Array
    try {
      pdf = await fastify.henrri.pdf(document.henrriDocumentId)
    } catch (err) {
      // Henrri down, slow or refusing: the customer gets a clean "try later", the log the cause.
      if (!(err instanceof HenrriError)) throw err
      request.log.warn({ err, documentId: params.data.documentId }, "Invoice PDF unavailable from Henrri")
      return unavailable()
    }
    return reply
      .code(200)
      .header("content-type", "application/pdf")
      .header("content-disposition", `attachment; filename="${pdfFileName(document)}"`)
      .header("cache-control", "private, no-store")
      .send(Buffer.from(pdf))
  })

  // GET /api/orders/:id — a single order owned by the authenticated user
  fastify.get("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(validationError(params.error.issues))
    }
    const userId = request.user.sub

    const [order] = await db
      .select({
        id: orders.id,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        legalVerificationStatus: orders.legalVerificationStatus,
        paymentStatus: orders.paymentStatus,
        subtotalHt: orders.subtotalHt,
        vatAmount: orders.vatAmount,
        totalTtc: orders.totalTtc,
        vipDiscountAmount: orders.vipDiscountAmount,
        vipDiscountAppliedPct: orders.vipDiscountAppliedPct,
        shippingCost: orders.shippingCost,
        shippingHt: orders.shippingHt,
        items: orders.itemsJson,
        shippingAddress: orders.shippingAddress,
        billingAddress: orders.billingAddress,
        shippingStatus: orders.shippingStatus,
        // Story 12.8d — an order born of a pro quote.
        quoteRequestId: orders.quoteRequestId,
        paymentTerms: orders.paymentTerms,
        invoiceDueAt: orders.paymentDueAt,
      })
      .from(orders)
      .where(and(eq(orders.id, params.data.id), eq(orders.userId, userId)))
      .limit(1)

    if (!order) {
      return reply.code(404).send({ error: "NotFound", message: "Order not found" })
    }

    // Parcels and their tracking (story 11.9) — without the admin's internal notes.
    const shipments = await customerShipments(order.id)

    // Payment buckets, so the storefront knows what to show (card form / RIB)
    // and each bucket's status without probing the payment endpoints.
    const [carte] = await db
      .select({ paymentStatus: paymentCarte.paymentStatus, amountTtc: paymentCarte.amountTtc })
      .from(paymentCarte)
      .where(eq(paymentCarte.orderId, order.id))
      .limit(1)
    const [virement] = await db
      .select({
        paymentStatus: paymentVirement.paymentStatus,
        amountExpectedTtc: paymentVirement.amountExpectedTtc,
        reference: paymentVirement.paymentReference,
        iban: paymentVirement.ibanRecipient,
        bic: paymentVirement.bicRecipient,
        bankName: paymentVirement.bankName,
        accountHolder: paymentVirement.accountHolderName,
      })
      .from(paymentVirement)
      .where(eq(paymentVirement.orderId, order.id))
      .limit(1)

    const invoices = await issuedDocumentsOfOrder(order.id)

    const { invoiceDueAt, ...visible } = order
    return reply.code(200).send({
      data: {
        ...visible,
        subtotalHt: Number(order.subtotalHt),
        vatAmount: Number(order.vatAmount),
        totalTtc: Number(order.totalTtc),
        vipDiscountAmount: Number(order.vipDiscountAmount),
        vipDiscountAppliedPct: Number(order.vipDiscountAppliedPct),
        shippingCost: Number(order.shippingCost),
        shippingHt: Number(order.shippingHt),
        shipments,
        paymentDueAt: paymentDueDate(order, Boolean(virement)),
        payment: {
          carte: carte ? { status: carte.paymentStatus, amountTtc: Number(carte.amountTtc) } : null,
          virement: virement
            ? {
                status: virement.paymentStatus,
                amountTtc: Number(virement.amountExpectedTtc),
                reference: virement.reference ?? "",
                iban: virement.iban,
                bic: virement.bic,
                bankName: virement.bankName,
                accountHolder: virement.accountHolder,
              }
            : null,
        },
        invoices,
      },
    })
  })

  // GET /api/orders/:id/legal — the order's legal checklist for the customer:
  // which doc types are required and where each one stands.
  fastify.get("/:id/legal", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(validationError(params.error.issues))
    }
    const userId = request.user.sub

    // Self-healing read: re-derive statuses (e.g. an async scan flagged a file)
    // before serving, so the stored state can never drift from the documents.
    await recomputeOrderLegalStatus(userId)

    const [order] = await db
      .select({
        id: orders.id,
        legalVerificationStatus: orders.legalVerificationStatus,
        legalRejectionReason: orders.legalRejectionReason,
        legalVerifiedAt: orders.legalVerifiedAt,
        itemsJson: orders.itemsJson,
      })
      .from(orders)
      .where(and(eq(orders.id, params.data.id), eq(orders.userId, userId)))
      .limit(1)
    if (!order) {
      return reply.code(404).send({ error: "NotFound", message: "Order not found" })
    }

    const requiredTypes = await requiredDocTypesFor(order.itemsJson)
    const requiredDocs =
      requiredTypes.length === 0 ? [] : buildRequiredDocsView(requiredTypes, await loadUserDocs(userId))

    return reply.code(200).send({
      data: {
        orderId: order.id,
        requiresVerification: requiredTypes.length > 0,
        legalVerificationStatus: order.legalVerificationStatus,
        legalRejectionReason: order.legalRejectionReason,
        legalVerifiedAt: order.legalVerifiedAt,
        requiredDocs,
      },
    })
  })
}
