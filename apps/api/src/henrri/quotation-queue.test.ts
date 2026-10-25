import { eq } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { henrriDocuments, organisations, quoteRequestItems, quoteRequests } from "../db/schema.js"
import { sendQuoteAvailableEmail } from "../email.js"
import { createFakeHenrri, FAKE_TYPES, type FakeHenrri } from "../test/henrri-fake.js"
import { type Account, proFixtures } from "../test/pro-fixtures.js"
import { enqueueQuotation, processPendingHenrriDocuments } from "./queue.js"

vi.mock("../email.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../email.js")>()),
  sendQuoteAvailableEmail: vi.fn(),
}))

const TAG = "quotequeue"
const silentLog = { info: () => {}, warn: () => {}, error: () => {} }
const parcel = { amountTtc: 25, priceHt: 20.83, vatAmount: 4.17, vatPct: 20, requiresPaymentVirement: true }
const VALID_UNTIL = new Date("2026-11-30T00:00:00Z")

describe("Henrri quotes (story 12.8d)", () => {
  let app: FastifyInstance
  let fixtures: ReturnType<typeof proFixtures>
  let pro: Account
  let henrri: FakeHenrri
  let counter = 0

  /** A quote SCS has priced and sent: 3 × 1 084,50 + 10,01 + 25 delivery = 3 941,21 TTC. */
  async function sentQuote(options: { organisationId?: string; totalTtc?: string } = {}) {
    counter += 1
    const [request] = await db
      .insert(quoteRequests)
      .values({
        number: `DR-QQ-${Date.now() % 1e8}-${counter}`,
        organisationId: options.organisationId ?? (pro.organisationId as string),
        requestedBy: pro.id,
        status: "in_review",
        validUntil: VALID_UNTIL,
        shippingPortions: [parcel],
        totalTtc: options.totalTtc ?? "3941.21",
      })
      .returning({ id: quoteRequests.id, number: quoteRequests.number })
    await db.insert(quoteRequestItems).values([
      {
        quoteRequestId: request.id,
        position: 1,
        productName: "Carabine",
        productSku: `${TAG}-CAR`,
        variantLabel: "Calibre .308",
        legalCategory: "C",
        qty: 3,
        publicPriceHt: "1205.00",
        vatPct: "20.00",
        quotedPriceHt: "1084.50",
        lineDiscountPct: "10.00",
      },
      {
        quoteRequestId: request.id,
        position: 2,
        productName: "Bretelle",
        productSku: `${TAG}-BRE`,
        qty: 1,
        publicPriceHt: "10.01",
        vatPct: "20.00",
        quotedPriceHt: "10.01",
        lineDiscountPct: "0.00",
      },
    ])
    await enqueueQuotation(request.id)
    return request
  }

  const documentOf = async (quoteRequestId: string) =>
    (await db.select().from(henrriDocuments).where(eq(henrriDocuments.quoteRequestId, quoteRequestId)))[0]
  const requestOf = async (id: string) => (await db.select().from(quoteRequests).where(eq(quoteRequests.id, id)))[0]
  const pass = () => processPendingHenrriDocuments(henrri.client, silentLog)

  async function withAddress(organisationId: string) {
    await db
      .update(organisations)
      .set({ billingLine1: "12 rue de la Paix", billingPostal: "75002", billingCity: "Paris" })
      .where(eq(organisations.id, organisationId))
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    fixtures = proFixtures(app, TAG)
    await fixtures.cleanup()
    // One Henrri for the file: its customer ids and numbers stay unique, as the real one's.
    henrri = createFakeHenrri()
  })

  beforeEach(async () => {
    vi.mocked(sendQuoteAvailableEmail).mockReset().mockResolvedValue(undefined)
    henrri.calls.length = 0
    pro = await fixtures.account({ organisation: "approved" })
    await withAddress(pro.organisationId as string)
  })

  afterAll(async () => {
    await fixtures.cleanup()
    await app.close()
  })

  it("issues the quote to the organisation, marks the request sent and mails the requester", async () => {
    const request = await sentQuote()

    await pass()

    const document = await documentOf(request.id)
    expect(document).toMatchObject({ kind: "quotation", status: "finalized", expectedTotalTtc: "3941.21" })
    expect(document.henrriNumber).toMatch(/^26-10-/)
    const issued = henrri.documents.get(document.henrriDocumentId as number)
    expect(issued).toMatchObject({
      documentTypeId: FAKE_TYPES.quotation,
      title: `Devis ${request.number} — valable jusqu'au 30/11/2026`,
    })
    expect(issued?.lines.map((line) => line.article.reference)).toEqual([`${TAG}-CAR`, `${TAG}-BRE`, "PORT"])
    expect(henrri.customers.get(issued?.customerId as number)).toEqual({
      companyName: `Armurerie ${TAG}`,
      siret: expect.any(String),
      contact: { firstName: "Jeanne", lastName: "Armand" },
      address: { line1: "12 rue de la Paix", line2: null, postal: "75002", city: "Paris", country: "FR" },
    })

    const sent = await requestOf(request.id)
    expect(sent.status).toBe("sent")
    expect(sent.sentAt).toBeInstanceOf(Date)
    expect(sendQuoteAvailableEmail).toHaveBeenCalledWith(
      pro.email,
      {
        quoteRequestId: request.id,
        number: request.number,
        henrriNumber: document.henrriNumber,
        amountTtc: 3941.21,
        validUntil: VALID_UNTIL,
      },
      { userId: pro.id },
    )
    expect((await documentOf(request.id)).customerNotifiedAt).toBeInstanceOf(Date)
  })

  it("creates the organisation's Henrri customer once, for all its quotes", async () => {
    await sentQuote()
    await pass()
    await sentQuote()
    await pass()

    expect(henrri.calls.filter((call) => call === "createCustomer")).toHaveLength(1)
    const [organisation] = await db
      .select({ henrriCustomerId: organisations.henrriCustomerId })
      .from(organisations)
      .where(eq(organisations.id, pro.organisationId as string))
    expect(organisation.henrriCustomerId).not.toBeNull()
  })

  it("records no payment on a quote", async () => {
    await sentQuote()
    await pass()
    expect(henrri.calls).not.toContain("payMilestone")
    expect(henrri.calls).not.toContain("paymentMilestones")
  })

  it("blocks a quote whose organisation has no billing address yet, leaving the request in review", async () => {
    await db
      .update(organisations)
      .set({ billingLine1: null })
      .where(eq(organisations.id, pro.organisationId as string))
    const request = await sentQuote()

    await pass()

    expect(await documentOf(request.id)).toMatchObject({ status: "blocked", lastError: "MissingBillingAddress" })
    expect((await requestOf(request.id)).status).toBe("in_review")
    expect(henrri.calls).not.toContain("createDocument")
  })

  it("blocks a quote whose frozen total its lines do not add up to", async () => {
    const request = await sentQuote({ totalTtc: "3941.20" })

    await pass()

    expect(await documentOf(request.id)).toMatchObject({ status: "blocked", lastError: "SnapshotMismatch" })
    expect(sendQuoteAvailableEmail).not.toHaveBeenCalled()
  })

  it("mails the requester again on the next pass when the e-mail failed", async () => {
    vi.mocked(sendQuoteAvailableEmail).mockRejectedValueOnce(new Error("smtp down"))
    const request = await sentQuote()

    await pass()
    expect((await documentOf(request.id)).customerNotifiedAt).toBeNull()
    expect((await requestOf(request.id)).status).toBe("sent")

    await pass()
    expect(sendQuoteAvailableEmail).toHaveBeenCalledTimes(2)
    expect((await documentOf(request.id)).customerNotifiedAt).toBeInstanceOf(Date)
  })

  // Story 12.8d-2 — the pro's acceptance becomes the quote's validation in Henrri.
  it("validates the issued quote in Henrri once the pro has accepted it, and only then", async () => {
    const request = await sentQuote()
    await pass()
    expect(henrri.calls).not.toContain("validateQuotation")

    const acceptedAt = new Date("2026-10-25T15:00:00Z")
    await db
      .update(quoteRequests)
      .set({ status: "converted", acceptedAt, acceptedBy: pro.id, acceptedIp: "203.0.113.7" })
      .where(eq(quoteRequests.id, request.id))
    await pass()
    await pass()

    const document = await documentOf(request.id)
    expect(document.validatedAt).toBeInstanceOf(Date)
    expect(henrri.documents.get(document.henrriDocumentId as number)?.validatedBy).toEqual({
      email: pro.email,
      firstName: "Jeanne",
      lastName: "Armand",
      at: acceptedAt,
      ip: "203.0.113.7",
    })
    expect(henrri.calls.filter((call) => call === "validateQuotation")).toHaveLength(1)
  })

  it("queues one quote at a time per request", async () => {
    const request = await sentQuote()
    await enqueueQuotation(request.id)
    expect(await db.select().from(henrriDocuments).where(eq(henrriDocuments.quoteRequestId, request.id))).toHaveLength(
      1,
    )
  })
})
