import { eq, inArray } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { henrriDocuments, orders, organisations, paymentVirement, quoteRequests } from "../db/schema.js"
import { createFakeHenrri, FAKE_TYPES, type FakeHenrri } from "../test/henrri-fake.js"
import { type Account, proFixtures } from "../test/pro-fixtures.js"
import { enqueueInvoice, processPendingHenrriDocuments } from "./queue.js"

vi.mock("../email.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../email.js")>()),
  sendInvoiceAvailableEmail: vi.fn().mockResolvedValue(undefined),
}))

const TAG = "quoteinvoice"
const silentLog = { info: () => {}, warn: () => {}, error: () => {} }
const parcel = { amountTtc: 25, priceHt: 20.83, vatAmount: 4.17, vatPct: 20 }
const address = { firstName: "Jeanne", lastName: "Armand", line2: null, country: "FR", phone: null }

describe("the invoice of an order born of a quote (story 12.8d)", () => {
  let app: FastifyInstance
  let fixtures: ReturnType<typeof proFixtures>
  let pro: Account
  let henrri: FakeHenrri
  let counter = 0

  /** 2 × 1 084,50 € HT + 25 € delivery = 2 627,80 € TTC, paid by transfer. */
  async function quoteOrder(options: { net30?: boolean; paid?: boolean; dueAt?: Date; shipped?: boolean } = {}) {
    counter += 1
    const [request] = await db
      .insert(quoteRequests)
      .values({
        number: `DR-QI-${Date.now() % 1e7}-${counter}`,
        organisationId: pro.organisationId as string,
        requestedBy: pro.id,
        status: "converted",
      })
      .returning({ id: quoteRequests.id })
    const [order] = await db
      .insert(orders)
      .values({
        userId: pro.id,
        quoteRequestId: request.id,
        paymentTerms: options.net30 ? "net30" : "immediate",
        paymentDueAt: options.dueAt ?? null,
        paymentStatus: options.paid ? "received" : "pending",
        legalVerificationStatus: "docs_verified",
        shippingStatus: options.shipped ? "shipped" : "unshipped",
        itemsJson: [
          {
            variantId: "00000000-0000-0000-0000-000000000001",
            qty: 2,
            priceHt: 1084.5,
            name: "Carabine — Calibre .308",
            sku: `${TAG}-CAR`,
            category: "arme-longue",
            legalCategory: "C",
            requiresPaymentVirement: true,
            vatPct: 20,
            discountHt: 0,
          },
        ],
        shippingPortions: [parcel],
        subtotalHt: "2169.00",
        vatAmount: "437.97",
        totalTtc: "2627.80",
        shippingCost: "25.00",
        shippingHt: "20.83",
        shippingAddress: { ...address, line1: "3 quai du Stand", postal: "69002", city: "Lyon" },
        billingAddress: { ...address, line1: "12 rue de la Paix", postal: "75002", city: "Paris" },
        chorusServiceCode: "SRV-42",
        chorusCommitmentNumber: "EJ-2026-118",
      })
      .returning({ id: orders.id })
    await db.insert(paymentVirement).values({
      orderId: order.id,
      amountExpectedTtc: "2627.80",
      amountReceivedTtc: options.paid ? "2627.80" : null,
      receivedAt: options.paid ? new Date("2026-10-26T09:00:00Z") : null,
      currency: "EUR",
      ibanRecipient: "FR7630006000011234567890189",
      bicRecipient: "AGRIFRPP",
      bankName: "Banque Test",
      accountHolderName: "SCS Firearms SAS",
      paymentReference: `SCS-QI${counter}-${Date.now() % 1e4}`,
      paymentStatus: options.paid ? "received" : "awaiting_transfer",
    })
    return order.id
  }

  const invoiceOf = async (orderId: string) =>
    (await db.select().from(henrriDocuments).where(eq(henrriDocuments.orderId, orderId)))[0]
  const pass = () => processPendingHenrriDocuments(henrri.client, silentLog)

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    fixtures = proFixtures(app, TAG)
    await fixtures.cleanup()
    henrri = createFakeHenrri()
    pro = await fixtures.account({ organisation: "approved" })
    await db
      .update(organisations)
      .set({ billingLine1: "12 rue de la Paix", billingPostal: "75002", billingCity: "Paris" })
      .where(eq(organisations.id, pro.organisationId as string))
  })

  beforeEach(() => {
    henrri.calls.length = 0
  })

  afterAll(async () => {
    const orderIds = db.select({ id: orders.id }).from(orders).where(eq(orders.userId, pro.id))
    await db.delete(henrriDocuments).where(inArray(henrriDocuments.orderId, orderIds))
    await db.delete(paymentVirement).where(inArray(paymentVirement.orderId, orderIds))
    await db.delete(orders).where(eq(orders.userId, pro.id))
    await fixtures.cleanup()
    await app.close()
  })

  it("is made out to the organisation, its title carrying the Chorus Pro references", async () => {
    const orderId = await quoteOrder({ paid: true })
    await enqueueInvoice(orderId)

    await pass()

    const invoice = await invoiceOf(orderId)
    expect(invoice).toMatchObject({ status: "finalized" })
    expect(invoice?.paymentRecordedAt).toBeInstanceOf(Date)
    const issued = henrri.documents.get(invoice?.henrriDocumentId as number)
    expect(issued?.documentTypeId).toBe(FAKE_TYPES.invoice)
    expect(issued?.title).toMatch(/^Commande \S+ — service SRV-42 — engagement EJ-2026-118$/)
    expect(henrri.customers.get(issued?.customerId as number)).toMatchObject({
      companyName: `Armurerie ${TAG}`,
      contact: { firstName: "Jeanne", lastName: "Armand" },
      address: { line1: "12 rue de la Paix", postal: "75002", city: "Paris" },
    })
  })

  it("on invoice, is issued unpaid with its 30 days written on it, then settled when the transfer lands", async () => {
    const orderId = await quoteOrder({ net30: true, dueAt: new Date("2026-11-25T10:00:00Z"), shipped: true })
    await enqueueInvoice(orderId)

    await pass()

    const invoice = await invoiceOf(orderId)
    expect(invoice).toMatchObject({ status: "finalized", paymentRecordedAt: null, heldAt: null })
    const issued = henrri.documents.get(invoice?.henrriDocumentId as number)
    expect(issued?.dueLabel).toMatch(
      /^Paiement à 30 jours, au plus tard le 25\/11\/2026, par virement \(référence SCS-/,
    )
    expect(henrri.calls).not.toContain("payMilestone")

    await db.update(orders).set({ paymentStatus: "received" }).where(eq(orders.id, orderId))
    await db
      .update(paymentVirement)
      .set({ amountReceivedTtc: "2627.80", receivedAt: new Date("2026-11-20T09:00:00Z"), paymentStatus: "received" })
      .where(eq(paymentVirement.orderId, orderId))
    await pass()

    expect((await invoiceOf(orderId))?.paymentRecordedAt).toBeInstanceOf(Date)
    expect(henrri.calls).toContain("payMilestone")
  })

  it("on invoice, dates Henrri's payment milestone 30 days on, once, and leaves it alone until paid", async () => {
    const orderId = await quoteOrder({ net30: true, dueAt: new Date("2026-11-25T10:00:00Z"), shipped: true })
    await enqueueInvoice(orderId)

    await pass()

    const invoice = await invoiceOf(orderId)
    expect(invoice?.dueDateRecordedAt).toBeInstanceOf(Date)
    const issued = henrri.documents.get(invoice?.henrriDocumentId as number)
    expect(issued?.milestones[0]?.dueDate).toBe("2026-11-25")

    // Unpaid, its work is done: later passes spend no call on it.
    henrri.calls.length = 0
    await pass()
    expect(henrri.calls).toEqual([])
  })

  it("catches up the invoice of an order on invoice that left without it", async () => {
    const orderId = await quoteOrder({ net30: true, dueAt: new Date("2026-11-25T10:00:00Z"), shipped: true })

    await pass()

    expect((await invoiceOf(orderId))?.status).toBe("finalized")
  })

  it("issues nothing for an order on invoice not shipped yet", async () => {
    const orderId = await quoteOrder({ net30: true })

    await pass()

    expect(await invoiceOf(orderId)).toBeUndefined()
  })
})
