import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, henrriDocuments, orders, refunds, users } from "../db/schema.js"
import { createFakeHenrri } from "../test/henrri-fake.js"

const PASSWORD = "MotDePasseTresLong123!"
const EMAIL_PREFIX = "invoices-test"

describe("customer invoices (story 12.6)", () => {
  const henrri = createFakeHenrri()
  let app: FastifyInstance
  let unconfigured: FastifyInstance
  let ownerToken: string
  let otherToken: string
  let orderId: string
  let invoiceId: string
  let creditNoteId: string
  let pendingId: string

  async function cleanup() {
    const userIds = db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `${EMAIL_PREFIX}%`))
    const orderIds = db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, userIds))
    await db.delete(henrriDocuments).where(inArray(henrriDocuments.orderId, orderIds))
    await db.delete(refunds).where(inArray(refunds.orderId, orderIds))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
    await db.delete(orders).where(inArray(orders.userId, userIds))
    await db.delete(users).where(like(users.email, `${EMAIL_PREFIX}%`))
  }

  async function makeUser(email: string) {
    const passwordHash = await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
    const [user] = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        role: "customer",
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id })
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } })
    return { id: user.id, token: login.json().accessToken as string }
  }

  /** A document finalized in the fake Henrri, returning its Henrri id. */
  async function issuedInHenrri(kind: "invoice" | "creditNote") {
    const id = await henrri.client.createDocument({
      documentTypeId: await henrri.client.documentTypeId(kind),
      customerId: 1,
      title: "Commande",
    })
    await henrri.client.addLine(id, {
      designation: "Tapis",
      article: { reference: "TAP-1", description: "Tapis" },
      quantity: 1,
      unitPrice: 100,
      vatPct: 20,
    })
    const finalized = await henrri.client.finalizeDocument(id)
    return { id, number: finalized.number ?? "" }
  }

  beforeAll(async () => {
    app = await buildApp({ henrri: henrri.client })
    await app.ready()
    unconfigured = await buildApp({ henrri: null })
    await unconfigured.ready()
    await cleanup()

    const owner = await makeUser(`${EMAIL_PREFIX}-owner@example.test`)
    ownerToken = owner.token
    otherToken = (await makeUser(`${EMAIL_PREFIX}-other@example.test`)).token

    const [order] = await db
      .insert(orders)
      .values({
        userId: owner.id,
        paymentStatus: "partially_refunded",
        itemsJson: [],
        subtotalHt: "100.00",
        vatAmount: "20.00",
        totalTtc: "120.00",
      })
      .returning({ id: orders.id })
    orderId = order.id

    const [refunded, stillRefunding] = await db
      .insert(refunds)
      .values([
        { orderId, channel: "carte", amountTtc: "20.00", status: "succeeded" },
        { orderId, channel: "carte", amountTtc: "10.00", status: "succeeded" },
      ])
      .returning({ id: refunds.id })
    const invoice = await issuedInHenrri("invoice")
    const creditNote = await issuedInHenrri("creditNote")
    const rows = await db
      .insert(henrriDocuments)
      .values([
        {
          orderId,
          kind: "invoice",
          status: "finalized",
          henrriDocumentId: invoice.id,
          henrriNumber: invoice.number,
          expectedTotalTtc: "120.00",
          finalizedAt: new Date("2026-10-14T10:00:00Z"),
        },
        {
          orderId,
          kind: "credit_note",
          refundId: refunded.id,
          status: "finalized",
          henrriDocumentId: creditNote.id,
          henrriNumber: creditNote.number,
          expectedTotalTtc: "20.00",
          finalizedAt: new Date("2026-10-14T11:00:00Z"),
        },
        { orderId, kind: "credit_note", refundId: stillRefunding.id, status: "pending", expectedTotalTtc: "10.00" },
      ])
      .returning({ id: henrriDocuments.id, kind: henrriDocuments.kind, status: henrriDocuments.status })
    invoiceId = rows[0].id
    creditNoteId = rows[1].id
    pendingId = rows[2].id
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
    await unconfigured.close()
  })

  const get = (url: string, token: string | null, target = app) =>
    target.inject({ method: "GET", url, headers: token ? { authorization: `Bearer ${token}` } : {} })

  it("lists the invoice and credit notes Henrri has issued on the order, nothing still on its way", async () => {
    const { data } = (await get(`/api/orders/${orderId}`, ownerToken)).json()
    expect(data.invoices).toEqual([
      { id: invoiceId, kind: "invoice", number: "26-10-1", amountTtc: 120, issuedAt: "2026-10-14T10:00:00.000Z" },
      { id: creditNoteId, kind: "credit_note", number: "26-10-2", amountTtc: 20, issuedAt: "2026-10-14T11:00:00.000Z" },
    ])
  })

  it("serves the invoice PDF as Henrri locked it, never cached", async () => {
    const res = await get(`/api/orders/${orderId}/invoices/${invoiceId}/pdf`, ownerToken)
    expect(res.statusCode).toBe(200)
    expect(res.headers["content-type"]).toBe("application/pdf")
    expect(res.headers["content-disposition"]).toBe('attachment; filename="Facture-26-10-1.pdf"')
    expect(res.headers["cache-control"]).toBe("private, no-store")
    expect(res.body).toBe("%PDF fake 26-10-1")
  })

  it("names a credit note's PDF as such", async () => {
    const res = await get(`/api/orders/${orderId}/invoices/${creditNoteId}/pdf`, ownerToken)
    expect(res.headers["content-disposition"]).toBe('attachment; filename="Avoir-26-10-2.pdf"')
  })

  it("refuses a document not issued yet, another customer, and anonymous callers", async () => {
    expect((await get(`/api/orders/${orderId}/invoices/${pendingId}/pdf`, ownerToken)).statusCode).toBe(404)
    expect((await get(`/api/orders/${orderId}/invoices/${invoiceId}/pdf`, otherToken)).statusCode).toBe(404)
    expect((await get(`/api/orders/${orderId}/invoices/${invoiceId}/pdf`, null)).statusCode).toBe(401)
  })

  it("answers 503 while Henrri is not configured", async () => {
    const res = await get(`/api/orders/${orderId}/invoices/${invoiceId}/pdf`, ownerToken, unconfigured)
    expect(res.statusCode).toBe(503)
    expect(res.json()).toMatchObject({ error: "InvoiceUnavailable" })
  })
})
