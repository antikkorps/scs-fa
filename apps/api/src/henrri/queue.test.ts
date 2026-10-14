import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { eq, inArray, like, sql } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { db } from "../db/client.js"
import {
  henrriDocuments,
  type OrderAddressSnapshot,
  orders,
  paymentCarte,
  paymentVirement,
  refunds,
  users,
} from "../db/schema.js"
import { sendInvoiceAvailableEmail } from "../email.js"
import { createFakeHenrri, FAKE_MODES, type FakeHenrri } from "../test/henrri-fake.js"
import { HenrriError } from "./client.js"
import { enqueueCreditNote, enqueueInvoice, henrriClientFromEnv, processPendingHenrriDocuments } from "./queue.js"

vi.mock("../email.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../email.js")>()),
  sendInvoiceAvailableEmail: vi.fn(),
}))

const EMAIL_PREFIX = "henrri-queue-test"
const silentLog = { info: () => {}, warn: () => {}, error: () => {} }

const address: OrderAddressSnapshot = {
  firstName: "Jean",
  lastName: "Tireur",
  line1: "1 rue du Tir",
  line2: null,
  postal: "75001",
  city: "Paris",
  country: "FR",
  phone: null,
}

const rifle = {
  variantId: "00000000-0000-0000-0000-000000000001",
  qty: 1,
  priceHt: 1000,
  name: "Carabine",
  sku: "CAR-1",
  category: "arme-longue",
  requiresPaymentVirement: true,
  vatPct: 20,
  discountHt: 0,
}
const mat = {
  variantId: "00000000-0000-0000-0000-000000000002",
  qty: 2,
  priceHt: 50,
  name: "Tapis de tir",
  sku: "TAP-1",
  category: "accessoire-tireur",
  requiresPaymentVirement: false,
  vatPct: 20,
  discountHt: 0,
}

let userCounter = 0

async function cleanup() {
  const userIds = db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${EMAIL_PREFIX}%`))
  const orderIds = db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, userIds))
  await db.delete(henrriDocuments).where(inArray(henrriDocuments.orderId, orderIds))
  await db.delete(refunds).where(inArray(refunds.orderId, orderIds))
  await db.delete(paymentCarte).where(inArray(paymentCarte.orderId, orderIds))
  await db.delete(paymentVirement).where(inArray(paymentVirement.orderId, orderIds))
  await db.delete(orders).where(inArray(orders.userId, userIds))
  await db.delete(users).where(like(users.email, `${EMAIL_PREFIX}%`))
}

async function createBuyer(henrriCustomerId: number | null = null) {
  userCounter += 1
  const [user] = await db
    .insert(users)
    .values({
      email: `${EMAIL_PREFIX}-${userCounter}@example.test`,
      passwordHash: "x",
      firstname: "Jean",
      lastname: "Tireur",
      role: "customer",
      rgpdConsentAt: new Date(),
      rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      henrriCustomerId,
    })
    .returning({ id: users.id })
  return user.id
}

/** A paid order: card-only (mat, 120 + 9 shipping) or mixed (rifle by transfer, mat by card). */
async function createPaidOrder(
  options: {
    mixed?: boolean
    legacy?: boolean
    userId?: string
    cardPaidAt?: Date
    transferReceived?: string
    billingCity?: string
  } = {},
) {
  const userId = options.userId ?? (await createBuyer())
  const smallParcel = { amountTtc: 9, priceHt: 7.5, vatAmount: 1.5, vatPct: 20 }
  const items = options.mixed ? [rifle, mat] : [mat]
  const totalTtc = options.mixed ? 1329 : 129
  const legacyItems = items.map(({ vatPct: _vatPct, discountHt: _discountHt, ...line }) => line)
  const [order] = await db
    .insert(orders)
    .values({
      userId,
      paymentStatus: "received",
      legalVerificationStatus: "payment_pending",
      itemsJson: options.legacy ? legacyItems : items,
      shippingPortions: options.legacy ? null : [smallParcel],
      subtotalHt: options.mixed ? "1100.00" : "100.00",
      vatAmount: options.mixed ? "221.50" : "21.50",
      totalTtc: totalTtc.toFixed(2),
      shippingCost: "9.00",
      shippingHt: "7.50",
      shippingAddress: address,
      billingAddress: options.billingCity ? { ...address, city: options.billingCity } : address,
    })
    .returning({ id: orders.id })
  await db.insert(paymentCarte).values({
    orderId: order.id,
    amountTtc: "129.00",
    paymentStatus: "received",
    currency: "EUR",
    processedAt: options.cardPaidAt ?? null,
  })
  if (options.mixed) {
    await db.insert(paymentVirement).values({
      orderId: order.id,
      amountExpectedTtc: "1200.00",
      amountReceivedTtc: options.transferReceived ?? "1200.00",
      ibanRecipient: "FR7630006000011234567890189",
      paymentStatus: "reconciled",
      receivedAt: new Date("2026-10-12T09:00:00Z"),
    })
  }
  return { orderId: order.id, userId }
}

async function documentsOf(orderId: string) {
  return db.select().from(henrriDocuments).where(eq(henrriDocuments.orderId, orderId))
}

async function invoiceOf(orderId: string) {
  const [invoice] = (await documentsOf(orderId)).filter((document) => document.kind === "invoice")
  return invoice
}

describe("Henrri queue (story 12.6)", () => {
  let henrri: FakeHenrri

  beforeEach(async () => {
    await cleanup()
    henrri = createFakeHenrri()
    vi.mocked(sendInvoiceAvailableEmail).mockReset().mockResolvedValue(undefined)
  })

  afterAll(cleanup)

  const sync = () => processPendingHenrriDocuments(henrri.client, silentLog)

  describe("enqueueing", () => {
    it("queues one invoice per order, at the order total, however often it is asked", async () => {
      const { orderId } = await createPaidOrder()
      await enqueueInvoice(orderId)
      await enqueueInvoice(orderId)

      const documents = await documentsOf(orderId)
      expect(documents).toHaveLength(1)
      expect(documents[0]).toMatchObject({ kind: "invoice", status: "pending", expectedTotalTtc: "129.00" })
    })

    it("queues one credit note per refund, at the refunded amount", async () => {
      const { orderId } = await createPaidOrder()
      await enqueueInvoice(orderId)
      const [refund] = await db
        .insert(refunds)
        .values({ orderId, channel: "carte", amountTtc: "50.00", status: "succeeded" })
        .returning({ id: refunds.id })
      await enqueueCreditNote(refund.id)
      await enqueueCreditNote(refund.id)

      const creditNotes = (await documentsOf(orderId)).filter((document) => document.kind === "credit_note")
      expect(creditNotes).toHaveLength(1)
      expect(creditNotes[0]).toMatchObject({ refundId: refund.id, status: "pending", expectedTotalTtc: "50.00" })
    })
  })

  describe("invoicing a paid order", () => {
    it("creates the buyer, bills the order, finalizes it and records the card payment", async () => {
      const { orderId, userId } = await createPaidOrder()
      await enqueueInvoice(orderId)
      await sync()

      const invoice = await invoiceOf(orderId)
      expect(invoice).toMatchObject({ status: "finalized", henrriNumber: "26-10-1", attempts: 1, lastError: null })
      expect(invoice.finalizedAt).toBeInstanceOf(Date)
      expect(invoice.paymentRecordedAt).toBeInstanceOf(Date)

      const [buyer] = await db
        .select({ henrriCustomerId: users.henrriCustomerId })
        .from(users)
        .where(eq(users.id, userId))
      expect(henrri.customers.get(buyer.henrriCustomerId ?? -1)).toMatchObject({
        firstName: "Jean",
        lastName: "Tireur",
        address: { line1: "1 rue du Tir", city: "Paris", country: "FR" },
      })

      const [document] = henrri.finalizedDocuments()
      expect(document.title).toBe(`Commande ${orderId.slice(0, 8).toUpperCase()}`)
      expect(document.lines.map((line) => line.designation)).toEqual(["Tapis de tir", "Frais de port"])
      expect(document.milestones).toEqual([expect.objectContaining({ paid: true, paymentModeId: FAKE_MODES.bankCard })])
    })

    it("reuses the buyer Henrri already knows, without rewriting an unchanged record", async () => {
      const userId = await createBuyer()
      const { orderId: first } = await createPaidOrder({ userId })
      await enqueueInvoice(first)
      await sync()
      const { orderId: second } = await createPaidOrder({ userId })
      await enqueueInvoice(second)
      await sync()

      // Henrri allows 100 calls an hour: an unchanged buyer costs none.
      expect(henrri.calls.filter((call) => call === "createCustomer")).toHaveLength(1)
      expect(henrri.calls.filter((call) => call === "updateCustomer")).toHaveLength(0)
    })

    it("updates the buyer's record when the billing address changed", async () => {
      const userId = await createBuyer()
      const { orderId: first } = await createPaidOrder({ userId })
      await enqueueInvoice(first)
      await sync()
      const { orderId: second } = await createPaidOrder({ userId, billingCity: "Lyon" })
      await enqueueInvoice(second)
      await sync()

      expect(henrri.calls.filter((call) => call === "updateCustomer")).toHaveLength(1)
      expect([...henrri.customers.values()].at(-1)?.address.city).toBe("Lyon")
    })

    it("creates the buyer again when Henrri no longer knows them", async () => {
      const userId = await createBuyer(999_999)
      await db.update(users).set({ henrriCustomerFingerprint: "stale" }).where(eq(users.id, userId))
      const { orderId } = await createPaidOrder({ userId })
      await enqueueInvoice(orderId)
      await sync()

      expect(await invoiceOf(orderId)).toMatchObject({ status: "finalized" })
      const [buyer] = await db
        .select({ henrriCustomerId: users.henrriCustomerId })
        .from(users)
        .where(eq(users.id, userId))
      expect(buyer.henrriCustomerId).not.toBe(999_999)
    })

    it("dates each payment on the day the money came in", async () => {
      const { orderId } = await createPaidOrder({ mixed: true, cardPaidAt: new Date("2026-10-11T22:30:00Z") })
      await enqueueInvoice(orderId)
      await sync()

      const [document] = henrri.finalizedDocuments()
      // 22:30 UTC on the 11th is already the 12th in Paris.
      expect(document.milestones.map((milestone) => milestone.date)).toEqual(["2026-10-12", "2026-10-12"])
    })

    it("holds an issued invoice whose payments do not add up, instead of marking it paid", async () => {
      // The admin accepted a transfer 5 € short.
      const { orderId } = await createPaidOrder({ mixed: true, transferReceived: "1195.00" })
      await enqueueInvoice(orderId)
      await sync()

      const invoice = await invoiceOf(orderId)
      expect(invoice).toMatchObject({
        status: "finalized",
        paymentRecordedAt: null,
        lastError: "PaymentMismatch: received 1324.00, invoiced 1329.00",
      })
      expect(invoice.heldAt).toBeInstanceOf(Date)
      const [document] = henrri.finalizedDocuments()
      expect(document.milestones).toEqual([
        expect.objectContaining({ amount: 129, paid: true }),
        expect.objectContaining({ amount: 1195, paid: true }),
        expect.objectContaining({ amount: 5, paid: false }),
      ])
    })

    it("records a mixed payment: the card share first, then the transfer for the rest", async () => {
      const { orderId } = await createPaidOrder({ mixed: true })
      await enqueueInvoice(orderId)
      await sync()

      const [document] = henrri.finalizedDocuments()
      expect(document.milestones).toEqual([
        expect.objectContaining({ amount: 129, paid: true, paymentModeId: FAKE_MODES.bankCard }),
        expect.objectContaining({ amount: 1200, paid: true, paymentModeId: FAKE_MODES.transfer }),
      ])
    })

    it("never finalizes an invoice whose Henrri total differs from ours", async () => {
      const { orderId } = await createPaidOrder()
      await enqueueInvoice(orderId)
      henrri.skewTotals(0.01)
      await sync()

      const invoice = await invoiceOf(orderId)
      expect(invoice.status).toBe("blocked")
      expect(invoice.lastError).toBe("TotalMismatch: Henrri 129.01, expected 129.00")
      expect(henrri.finalizedDocuments()).toHaveLength(0)
    })

    it("blocks an order placed before the invoice snapshot, without calling Henrri", async () => {
      const { orderId } = await createPaidOrder({ legacy: true })
      await enqueueInvoice(orderId)
      await sync()

      expect(await invoiceOf(orderId)).toMatchObject({ status: "blocked", lastError: "LegacySnapshot" })
      expect(henrri.calls).toEqual([])
    })

    it("blocks on a business refusal, keeping Henrri's message", async () => {
      const { orderId } = await createPaidOrder()
      await enqueueInvoice(orderId)
      henrri.failNext("finalizeDocument", new HenrriError("NUMBERING_ERROR", 400, "Numbering failed"))
      await sync()

      expect(await invoiceOf(orderId)).toMatchObject({
        status: "blocked",
        lastError: "NUMBERING_ERROR: Numbering failed",
      })
    })
  })

  describe("telling the buyer", () => {
    it("e-mails the buyer once the invoice is issued, and only once", async () => {
      const { orderId } = await createPaidOrder()
      await enqueueInvoice(orderId)
      await sync()
      await sync()

      expect(vi.mocked(sendInvoiceAvailableEmail)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(sendInvoiceAvailableEmail)).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`^${EMAIL_PREFIX}`)),
        { orderId, orderRef: orderId.slice(0, 8).toUpperCase(), kind: "invoice", number: "26-10-1", amountTtc: 129 },
      )
      expect((await invoiceOf(orderId)).customerNotifiedAt).toBeInstanceOf(Date)
    })

    it("tries the e-mail again on the next pass when it fails, without touching Henrri", async () => {
      const { orderId } = await createPaidOrder()
      await enqueueInvoice(orderId)
      vi.mocked(sendInvoiceAvailableEmail).mockRejectedValueOnce(new Error("SMTP down"))
      await sync()
      expect(await invoiceOf(orderId)).toMatchObject({ status: "finalized", customerNotifiedAt: null, lastError: null })

      const henrriCallsBefore = henrri.calls.length
      await sync()
      expect((await invoiceOf(orderId)).customerNotifiedAt).toBeInstanceOf(Date)
      expect(henrri.calls.length).toBe(henrriCallsBefore)
    })
  })

  describe("retries", () => {
    it("waits when Henrri is down, then finalizes the draft it left, already complete", async () => {
      const { orderId } = await createPaidOrder()
      await enqueueInvoice(orderId)
      henrri.failNext("finalizeDocument", new HenrriError("Http503", 503, "Unavailable"))
      await sync()

      const stalled = await invoiceOf(orderId)
      expect(stalled).toMatchObject({
        status: "draft",
        attempts: 1,
        lastError: "Http503: Unavailable",
        claimedAt: null,
        claimToken: null,
      })

      await sync()
      const invoice = await invoiceOf(orderId)
      expect(invoice).toMatchObject({ status: "finalized", attempts: 2, lastError: null })
      // Its total matched to the cent: finalized as is, not rebuilt (calls are rationed).
      expect(invoice.henrriDocumentId).toBe(stalled.henrriDocumentId)
      expect(henrri.calls.filter((call) => call === "createDocument")).toHaveLength(1)
      expect(henrri.finalizedDocuments()).toHaveLength(1)
    })

    it("rebuilds a draft left incomplete", async () => {
      const { orderId } = await createPaidOrder()
      await enqueueInvoice(orderId)
      // The shipping line never made it.
      henrri.failNext("addLine", new HenrriError("Timeout", null, "Slow"))
      await sync()
      const stalled = await invoiceOf(orderId)
      expect(stalled.status).toBe("draft")

      await sync()
      const invoice = await invoiceOf(orderId)
      expect(invoice.status).toBe("finalized")
      expect(henrri.documents.has(stalled.henrriDocumentId ?? -1)).toBe(false)
      expect(henrri.finalizedDocuments()).toHaveLength(1)
    })

    it("stops the pass at the first sign of trouble, sparing Henrri's rationed calls", async () => {
      const first = await createPaidOrder()
      const second = await createPaidOrder()
      await enqueueInvoice(first.orderId)
      await enqueueInvoice(second.orderId)
      henrri.failNext("createDocument", new HenrriError("Http429", 429, "Too many requests"))
      const result = await sync()

      expect(result).toMatchObject({ halted: true })
      expect(henrri.calls.filter((call) => call === "createDocument")).toHaveLength(1)
      expect(await invoiceOf(second.orderId)).toMatchObject({ status: "pending", attempts: 0 })
    })

    it("waits, rather than blocks, when Henrri refuses our credentials", async () => {
      const { orderId } = await createPaidOrder()
      await enqueueInvoice(orderId)
      henrri.failNext("createCustomer", new HenrriError("AuthenticationFailed", 401, "Refused"))
      await sync()

      expect(await invoiceOf(orderId)).toMatchObject({ status: "pending", lastError: "AuthenticationFailed: Refused" })
    })

    it("asks again for a number Henrri gave without sending it", async () => {
      const { orderId } = await createPaidOrder()
      await enqueueInvoice(orderId)
      henrri.withholdNextNumber()
      await sync()
      expect(await invoiceOf(orderId)).toMatchObject({ status: "draft", henrriNumber: null })

      await sync()
      expect(await invoiceOf(orderId)).toMatchObject({ status: "finalized", henrriNumber: "26-10-1" })
      expect(henrri.finalizedDocuments()).toHaveLength(1)
    })

    it("keeps an issued invoice issued when Henrri refuses its payment, held for an admin", async () => {
      const { orderId } = await createPaidOrder()
      await enqueueInvoice(orderId)
      henrri.failNext("payMilestone", new HenrriError("PAYMENT_DATE_REQUIRED", 400, "Date required"))
      await sync()

      const invoice = await invoiceOf(orderId)
      expect(invoice).toMatchObject({
        status: "finalized",
        henrriNumber: "26-10-1",
        paymentRecordedAt: null,
        lastError: "PAYMENT_DATE_REQUIRED: Date required",
      })
      expect(invoice.heldAt).toBeInstanceOf(Date)

      // Held: later passes leave it alone until an admin retries.
      await sync()
      expect(henrri.calls.filter((call) => call === "payMilestone")).toHaveLength(1)
    })

    it("never lets a pass that lost its claim overwrite the pass that took over", async () => {
      const { orderId } = await createPaidOrder()
      await enqueueInvoice(orderId)
      // While the first pass waits on Henrri, its claim expires and another pass takes the row.
      henrri.beforeNext("finalizeDocument", async () => {
        await db
          .update(henrriDocuments)
          .set({ claimToken: "00000000-0000-4000-8000-000000000000", status: "blocked", lastError: "other pass" })
          .where(eq(henrriDocuments.orderId, orderId))
      })
      const result = await sync()

      expect(result.skipped).toBe(1)
      expect(await invoiceOf(orderId)).toMatchObject({ status: "blocked", lastError: "other pass" })
    })

    it("records a generic code, not the raw text, for an unexpected error", async () => {
      const { orderId } = await createPaidOrder()
      await enqueueInvoice(orderId)
      henrri.beforeNext("createCustomer", async () => {
        throw new Error("duplicate key value violates unique constraint (email)=(jean@example.test)")
      })
      await sync()

      expect((await invoiceOf(orderId)).lastError).toBe("InternalError")
    })

    it("picks up an invoice finalized just before a crash, without issuing a second one", async () => {
      const { orderId } = await createPaidOrder()
      await enqueueInvoice(orderId)
      // The process died after Henrri finalized but before the number was saved.
      henrri.failNext("paymentModeId", new HenrriError("NetworkError", null, "Lost"))
      await sync()
      await db
        .update(henrriDocuments)
        .set({ status: "draft", henrriNumber: null })
        .where(eq(henrriDocuments.orderId, orderId))

      await sync()
      expect(await invoiceOf(orderId)).toMatchObject({ status: "finalized", henrriNumber: "26-10-1" })
      expect(henrri.finalizedDocuments()).toHaveLength(1)
    })

    it("records a payment that failed after finalization on the next pass, once", async () => {
      const { orderId } = await createPaidOrder()
      await enqueueInvoice(orderId)
      henrri.failNext("payMilestone", new HenrriError("Http500", 500, "Oops"))
      await sync()
      expect(await invoiceOf(orderId)).toMatchObject({ status: "finalized", paymentRecordedAt: null })

      await sync()
      await sync()
      expect((await invoiceOf(orderId)).paymentRecordedAt).toBeInstanceOf(Date)
      expect(henrri.calls.filter((call) => call === "payMilestone")).toHaveLength(2)
    })

    it("leaves a document another pass has just claimed alone", async () => {
      const { orderId } = await createPaidOrder()
      await enqueueInvoice(orderId)
      await db.update(henrriDocuments).set({ claimedAt: new Date() }).where(eq(henrriDocuments.orderId, orderId))
      await sync()

      expect(await invoiceOf(orderId)).toMatchObject({ status: "pending", attempts: 0 })
      expect(henrri.calls).toEqual([])
    })
  })

  describe("edge cases (audit 2026-10-14)", () => {
    it("blocks an order without a billing address, without calling Henrri", async () => {
      const { orderId } = await createPaidOrder()
      await db.update(orders).set({ billingAddress: null, shippingAddress: null }).where(eq(orders.id, orderId))
      await enqueueInvoice(orderId)
      await sync()

      expect(await invoiceOf(orderId)).toMatchObject({ status: "blocked", lastError: "MissingBillingAddress" })
      expect(henrri.calls).toEqual([])
    })

    it("takes over a claim abandoned for more than ten minutes", async () => {
      const { orderId } = await createPaidOrder()
      await enqueueInvoice(orderId)
      await db
        .update(henrriDocuments)
        .set({ claimedAt: sql`now() - interval '11 minutes'`, claimToken: "00000000-0000-4000-8000-000000000001" })
        .where(eq(henrriDocuments.orderId, orderId))
      await sync()

      expect(await invoiceOf(orderId)).toMatchObject({ status: "finalized", claimToken: null })
    })

    it("issues invoices before credit notes, whatever order they were queued in", async () => {
      const { orderId } = await createPaidOrder()
      await enqueueInvoice(orderId)
      const [refund] = await db
        .insert(refunds)
        .values({ orderId, channel: "carte", amountTtc: "50.00", status: "succeeded" })
        .returning({ id: refunds.id })
      await enqueueCreditNote(refund.id)
      // The credit note row is older than the invoice row.
      await db
        .update(henrriDocuments)
        .set({ createdAt: sql`now() - interval '1 day'` })
        .where(eq(henrriDocuments.refundId, refund.id))
      await sync()

      // One pass did both: had the credit note gone first, it would have waited.
      const statuses = (await documentsOf(orderId)).map((document) => [document.kind, document.status])
      expect(statuses).toEqual(
        expect.arrayContaining([
          ["invoice", "finalized"],
          ["credit_note", "finalized"],
        ]),
      )
    })

    it("tells the buyer of a credit note as such", async () => {
      const { orderId } = await createPaidOrder()
      await enqueueInvoice(orderId)
      await db.insert(refunds).values({ orderId, channel: "carte", amountTtc: "50.00", status: "succeeded" })
      await sync()

      expect(vi.mocked(sendInvoiceAvailableEmail)).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ kind: "credit_note", number: "26-10-2", amountTtc: 50 }),
      )
    })
  })

  describe("catching up", () => {
    it("queues the invoice of a paid order that never got one", async () => {
      const { orderId } = await createPaidOrder()
      await sync()
      expect(await invoiceOf(orderId)).toMatchObject({ status: "finalized" })
    })

    it("leaves orders placed before the invoice snapshot out of the catch-up", async () => {
      const { orderId } = await createPaidOrder({ legacy: true })
      await sync()
      expect(await documentsOf(orderId)).toEqual([])
    })

    it("queues a credit note only once the order has an invoice", async () => {
      const { orderId } = await createPaidOrder()
      const [refund] = await db
        .insert(refunds)
        .values({ orderId, channel: "carte", amountTtc: "50.00", status: "succeeded" })
        .returning({ id: refunds.id })
      await enqueueCreditNote(refund.id)
      expect(await documentsOf(orderId)).toEqual([])

      await sync()
      await sync()
      const kinds = (await documentsOf(orderId)).map((document) => [document.kind, document.status])
      expect(kinds).toEqual(
        expect.arrayContaining([
          ["invoice", "finalized"],
          ["credit_note", "finalized"],
        ]),
      )
    })
  })

  describe("credit notes", () => {
    async function refundOf(orderId: string, amountTtc: string) {
      const [refund] = await db
        .insert(refunds)
        .values({ orderId, channel: "carte", amountTtc, status: "succeeded" })
        .returning({ id: refunds.id })
      await enqueueCreditNote(refund.id)
      return refund.id
    }

    async function creditNoteOf(orderId: string) {
      const [creditNote] = (await documentsOf(orderId)).filter((document) => document.kind === "credit_note")
      return creditNote
    }

    it("issues the credit note of a partial refund once the invoice is out", async () => {
      const { orderId } = await createPaidOrder()
      await enqueueInvoice(orderId)
      await refundOf(orderId, "50.00")
      await sync()

      expect(await creditNoteOf(orderId)).toMatchObject({ status: "finalized", henrriNumber: "26-10-2" })
      const creditNote = henrri.finalizedDocuments().find((document) => document.documentTypeId === 2)
      expect(creditNote?.title).toBe(`Avoir — commande ${orderId.slice(0, 8).toUpperCase()}`)
      expect(creditNote?.lines).toEqual([expect.objectContaining({ unitPrice: 41.67, vatPct: 20 })])
      expect((await creditNoteOf(orderId)).paymentRecordedAt).toBeNull()
    })

    it("credits a returned article on its own line, then a goodwill gesture on what is left", async () => {
      const { orderId } = await createPaidOrder()
      await enqueueInvoice(orderId)
      await db.insert(refunds).values({
        orderId,
        channel: "carte",
        kind: "goods_return",
        lines: [{ item: 0, qty: 1 }],
        amountTtc: "60.00",
        status: "succeeded",
      })
      await sync()

      const creditNote = henrri.finalizedDocuments().find((document) => document.documentTypeId === 2)
      // One of the two mats: 100 HT net / 2.
      expect(creditNote?.lines).toEqual([
        expect.objectContaining({ designation: "Retour — Tapis de tir", unitPrice: 50, vatPct: 20 }),
      ])
      expect(await creditNoteOf(orderId)).toMatchObject({ status: "finalized", expectedTotalTtc: "60.00" })
    })

    it("issues no credit note for an overpayment refund", async () => {
      const { orderId } = await createPaidOrder()
      await enqueueInvoice(orderId)
      const [overpayment] = await db
        .insert(refunds)
        .values({ orderId, channel: "virement", kind: "overpayment", amountTtc: "5.00", status: "succeeded" })
        .returning({ id: refunds.id })
      await enqueueCreditNote(overpayment.id)
      await sync()

      expect(await creditNoteOf(orderId)).toBeUndefined()
    })

    it("waits for an invoice that is still on its way", async () => {
      const { orderId } = await createPaidOrder()
      await enqueueInvoice(orderId)
      await refundOf(orderId, "50.00")
      henrri.failNext("createDocument", new HenrriError("Http503", 503, "Unavailable"))
      await sync()

      expect(await creditNoteOf(orderId)).toMatchObject({ status: "pending", lastError: null })
      await sync()
      expect(await creditNoteOf(orderId)).toMatchObject({ status: "finalized" })
    })

    it("blocks the credit note of an order whose invoice is blocked", async () => {
      const { orderId } = await createPaidOrder({ legacy: true })
      await enqueueInvoice(orderId)
      await refundOf(orderId, "50.00")
      await sync()

      expect(await creditNoteOf(orderId)).toMatchObject({ status: "blocked", lastError: "InvoiceBlocked" })
    })

    it("blocks a refund amount Henrri cannot express", async () => {
      const { orderId } = await createPaidOrder()
      await enqueueInvoice(orderId)
      await refundOf(orderId, "33.33")
      await sync()

      expect(await creditNoteOf(orderId)).toMatchObject({ status: "blocked", lastError: "InexpressibleAmount" })
    })
  })
})

describe("henrriClientFromEnv", () => {
  it("never reaches the real Henrri from the test suite, even with credentials in .env", () => {
    expect(henrriClientFromEnv()).toBeNull()
  })
})
