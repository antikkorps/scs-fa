import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { eq, inArray, like } from "drizzle-orm"
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
async function createPaidOrder(options: { mixed?: boolean; legacy?: boolean; userId?: string } = {}) {
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
      billingAddress: address,
    })
    .returning({ id: orders.id })
  await db
    .insert(paymentCarte)
    .values({ orderId: order.id, amountTtc: "129.00", paymentStatus: "received", currency: "EUR" })
  if (options.mixed) {
    await db.insert(paymentVirement).values({
      orderId: order.id,
      amountExpectedTtc: "1200.00",
      amountReceivedTtc: "1200.00",
      ibanRecipient: "FR7630006000011234567890189",
      paymentStatus: "reconciled",
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

    it("updates a buyer Henrri already knows instead of creating a second one", async () => {
      const userId = await createBuyer()
      const { orderId: first } = await createPaidOrder({ userId })
      await enqueueInvoice(first)
      await sync()
      const { orderId: second } = await createPaidOrder({ userId })
      await enqueueInvoice(second)
      await sync()

      expect(henrri.calls.filter((call) => call === "createCustomer")).toHaveLength(1)
      expect(henrri.calls.filter((call) => call === "updateCustomer")).toHaveLength(1)
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
    it("waits when Henrri is down, then rebuilds the abandoned draft rather than adding to it", async () => {
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
      })
      const abandonedDraft = stalled.henrriDocumentId

      await sync()
      const invoice = await invoiceOf(orderId)
      expect(invoice).toMatchObject({ status: "finalized", attempts: 2, lastError: null })
      expect(henrri.documents.has(abandonedDraft ?? -1)).toBe(false)
      expect(henrri.finalizedDocuments()).toHaveLength(1)
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
