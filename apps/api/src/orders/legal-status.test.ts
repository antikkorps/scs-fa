import { randomUUID } from "node:crypto"
import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import FormData from "form-data"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, legalDocuments, orders, users } from "../db/schema.js"
import { scanDocument } from "../legal-documents/scan.js"

vi.mock("../email.js", () => ({
  sendLegalDocApprovedEmail: vi.fn().mockResolvedValue(undefined),
  sendLegalDocRejectedEmail: vi.fn().mockResolvedValue(undefined),
}))

const PASSWORD = "MotDePasseTresLong123!"
const ADMIN_EMAIL = "orderlegal-test-admin@orderlegal-test.local"
const CUSTOMER_EMAIL = "orderlegal-test-customer@orderlegal-test.local"
const OTHER_EMAIL = "orderlegal-test-other@orderlegal-test.local"

const PDF = Buffer.from("%PDF-1.4\n%fake pdf for tests\n")

describe("order legal status (/api/orders/:id/legal)", () => {
  let app: FastifyInstance
  let adminToken: string
  let customerToken: string
  let customerId: string
  let otherToken: string
  let otherId: string

  async function cleanup() {
    const userIds = db.select({ id: users.id }).from(users).where(like(users.email, "orderlegal-test%"))
    await db.delete(orders).where(inArray(orders.userId, userIds))
    await db.delete(legalDocuments).where(inArray(legalDocuments.userId, userIds))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
    await db.delete(users).where(like(users.email, "orderlegal-test%"))
  }

  async function makeUser(email: string, role: "customer" | "admin") {
    const passwordHash = await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
    const [u] = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        role,
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id })
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } })
    return { id: u.id, token: login.json().accessToken as string }
  }

  /** Insert an order directly with the given legal categories on its lines. */
  async function seedOrder(userId: string, legalCategories: (string | null)[], status?: string) {
    const itemsJson = legalCategories.map((cat, i) => ({
      variantId: randomUUID(),
      qty: 1,
      priceHt: 100,
      name: `Item ${i}`,
      sku: `LEGAL43-${i}`,
      category: cat === null ? "accessoire-autre" : "arme-longue",
      ...(cat === null ? {} : { legalCategory: cat }),
      requiresPaymentVirement: false,
    }))
    const needsVerification = legalCategories.some((c) => c !== null && c !== "none")
    const [o] = await db
      .insert(orders)
      .values({
        userId,
        legalVerificationStatus: (status ?? (needsVerification ? "pending" : "payment_pending")) as never,
        paymentStatus: "pending",
        itemsJson: itemsJson as never,
        subtotalHt: "100.00",
        vatAmount: "20.00",
        totalTtc: "120.00",
      })
      .returning({ id: orders.id })
    return o.id
  }

  /** Upload a document through the real endpoint (triggers the recompute hook), then run its scan. */
  async function uploadDoc(docType: string, token = customerToken, { scan = true } = {}) {
    const form = new FormData()
    form.append("docType", docType)
    form.append("file", PDF, { filename: `${docType}.pdf`, contentType: "application/pdf" })
    const res = await app.inject({
      method: "POST",
      url: "/api/legal-documents",
      headers: { authorization: `Bearer ${token}`, ...form.getHeaders() },
      payload: form,
    })
    expect(res.statusCode).toBe(201)
    const id = res.json().data.id as string
    // The route fires its own async scan stub; wait for it to settle so the
    // test can then pin the scan state deterministically.
    await vi.waitFor(async () => {
      const [d] = await db
        .select({ scannedAt: legalDocuments.scannedAt })
        .from(legalDocuments)
        .where(eq(legalDocuments.id, id))
      expect(d.scannedAt).not.toBeNull()
    })
    if (scan) {
      await scanDocument(id)
    } else {
      await db.update(legalDocuments).set({ scanStatus: "pending", scannedAt: null }).where(eq(legalDocuments.id, id))
    }
    return id
  }

  function decide(docId: string, verb: "approve" | "reject", body?: object) {
    return app.inject({
      method: "POST",
      url: `/api/admin/legal-documents/${docId}/${verb}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: body ?? {},
    })
  }

  function getLegal(orderId: string, token = customerToken) {
    return app.inject({
      method: "GET",
      url: `/api/orders/${orderId}/legal`,
      headers: { authorization: `Bearer ${token}` },
    })
  }

  async function orderStatusInDb(orderId: string) {
    const [row] = await db
      .select({
        status: orders.legalVerificationStatus,
        rejectionReason: orders.legalRejectionReason,
        verifiedAt: orders.legalVerifiedAt,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
    return row
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()
    const admin = await makeUser(ADMIN_EMAIL, "admin")
    adminToken = admin.token
    const customer = await makeUser(CUSTOMER_EMAIL, "customer")
    customerId = customer.id
    customerToken = customer.token
    const other = await makeUser(OTHER_EMAIL, "customer")
    otherId = other.id
    otherToken = other.token
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  beforeEach(async () => {
    await db.delete(orders).where(inArray(orders.userId, [customerId, otherId]))
    await db.delete(legalDocuments).where(inArray(legalDocuments.userId, [customerId, otherId]))
  })

  // ── Endpoint basics ───────────────────────────────────────────────────────

  it("requires authentication and enforces ownership", async () => {
    const orderId = await seedOrder(customerId, ["C"])
    const anon = await app.inject({ method: "GET", url: `/api/orders/${orderId}/legal` })
    expect(anon.statusCode).toBe(401)
    const theirs = await getLegal(orderId, otherToken)
    expect(theirs.statusCode).toBe(404)
  })

  it("returns 404 for an unknown order", async () => {
    const res = await getLegal("00000000-0000-0000-0000-000000000000")
    expect(res.statusCode).toBe(404)
  })

  it("reports no verification needed for an order without regulated items", async () => {
    const orderId = await seedOrder(customerId, [null, "none"])
    const res = await getLegal(orderId)
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data).toMatchObject({
      orderId,
      requiresVerification: false,
      legalVerificationStatus: "payment_pending",
      requiredDocs: [],
    })
  })

  // ── Required docs derivation ──────────────────────────────────────────────

  it("derives required doc types from the order's legal categories, all missing initially", async () => {
    const orderId = await seedOrder(customerId, ["C"])
    const res = await getLegal(orderId)
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data.requiresVerification).toBe(true)
    expect(data.legalVerificationStatus).toBe("pending")
    const byType = Object.fromEntries(
      data.requiredDocs.map((d: { docType: string; status: string }) => [d.docType, d.status]),
    )
    expect(byType).toEqual({ cni: "missing", permis_chasse: "missing", sia: "missing" })
  })

  it("unions required docs across several legal categories", async () => {
    const orderId = await seedOrder(customerId, ["B", "C", null])
    const res = await getLegal(orderId)
    const types = res
      .json()
      .data.requiredDocs.map((d: { docType: string }) => d.docType)
      .sort()
    expect(types).toEqual(["autorisation_det", "cni", "permis_chasse", "sia"])
  })

  // ── Transitions driven by document lifecycle ──────────────────────────────

  it("stays pending while required docs are missing, and reflects uploaded doc states", async () => {
    const orderId = await seedOrder(customerId, ["C"])
    const docId = await uploadDoc("cni", customerToken, { scan: false })

    // Upload hook ran, but two docs are still missing → order stays pending
    expect((await orderStatusInDb(orderId)).status).toBe("pending")

    let res = await getLegal(orderId)
    let cni = res.json().data.requiredDocs.find((d: { docType: string }) => d.docType === "cni")
    expect(cni).toMatchObject({ status: "pending_scan", documentId: docId })

    await scanDocument(docId)
    res = await getLegal(orderId)
    cni = res.json().data.requiredDocs.find((d: { docType: string }) => d.docType === "cni")
    expect(cni.status).toBe("pending_review")
  })

  it("moves to docs_verifying once every required doc is uploaded", async () => {
    const orderId = await seedOrder(customerId, ["C"])
    await uploadDoc("cni")
    await uploadDoc("permis_chasse")
    await uploadDoc("sia")
    expect((await orderStatusInDb(orderId)).status).toBe("docs_verifying")
  })

  it("moves to docs_verified when the admin approves every required doc", async () => {
    const orderId = await seedOrder(customerId, ["C"])
    const ids = [await uploadDoc("cni"), await uploadDoc("permis_chasse"), await uploadDoc("sia")]
    for (const id of ids) {
      const res = await decide(id, "approve")
      expect(res.statusCode).toBe(200)
    }

    const row = await orderStatusInDb(orderId)
    expect(row.status).toBe("docs_verified")
    expect(row.verifiedAt).not.toBeNull()

    const res = await getLegal(orderId)
    const statuses = res.json().data.requiredDocs.map((d: { status: string }) => d.status)
    expect(statuses).toEqual(["approved", "approved", "approved"])
  })

  it("moves to docs_rejected when a required doc is rejected, exposing the reason", async () => {
    const orderId = await seedOrder(customerId, ["C"])
    const cniId = await uploadDoc("cni")
    const permisId = await uploadDoc("permis_chasse")
    await uploadDoc("sia")
    await decide(cniId, "approve")
    const rej = await decide(permisId, "reject", { reason: "document_expired", notes: "Expired in 2023" })
    expect(rej.statusCode).toBe(200)

    const row = await orderStatusInDb(orderId)
    expect(row.status).toBe("docs_rejected")
    expect(row.rejectionReason).toBe("document_expired")

    const res = await getLegal(orderId)
    const permis = res.json().data.requiredDocs.find((d: { docType: string }) => d.docType === "permis_chasse")
    expect(permis).toMatchObject({ status: "rejected", rejectionReason: "document_expired" })
  })

  it("returns to docs_verifying after re-uploading a rejected doc (D1: re-upload allowed)", async () => {
    const orderId = await seedOrder(customerId, ["C"])
    const cniId = await uploadDoc("cni")
    const permisId = await uploadDoc("permis_chasse")
    const siaId = await uploadDoc("sia")
    await decide(cniId, "approve")
    await decide(siaId, "approve")
    await decide(permisId, "reject", { reason: "document_illegible" })
    expect((await orderStatusInDb(orderId)).status).toBe("docs_rejected")

    // Customer re-uploads the rejected doc type → back under review
    await uploadDoc("permis_chasse")
    const row = await orderStatusInDb(orderId)
    expect(row.status).toBe("docs_verifying")
    expect(row.rejectionReason).toBeNull()
  })

  it("regresses to pending when a doc under review is deleted", async () => {
    const orderId = await seedOrder(customerId, ["C"])
    await uploadDoc("cni")
    await uploadDoc("permis_chasse")
    const siaId = await uploadDoc("sia")
    expect((await orderStatusInDb(orderId)).status).toBe("docs_verifying")

    const del = await app.inject({
      method: "DELETE",
      url: `/api/legal-documents/${siaId}`,
      headers: { authorization: `Bearer ${customerToken}` },
    })
    expect(del.statusCode).toBe(204)
    expect((await orderStatusInDb(orderId)).status).toBe("pending")
  })

  it("does not regress an order once docs_verified", async () => {
    const orderId = await seedOrder(customerId, ["D"])
    const cniId = await uploadDoc("cni")
    await decide(cniId, "approve")
    expect((await orderStatusInDb(orderId)).status).toBe("docs_verified")

    // Deleting the approved doc afterwards must not undo the order verification
    await app.inject({
      method: "DELETE",
      url: `/api/legal-documents/${cniId}`,
      headers: { authorization: `Bearer ${customerToken}` },
    })
    expect((await orderStatusInDb(orderId)).status).toBe("docs_verified")
  })

  it("flags an infected document and keeps the order pending (self-healing read)", async () => {
    const orderId = await seedOrder(customerId, ["D"])
    const docId = await uploadDoc("cni", customerToken, { scan: false })
    await db
      .update(legalDocuments)
      .set({ scanStatus: "infected", scannedAt: new Date() })
      .where(eq(legalDocuments.id, docId))

    const res = await getLegal(orderId)
    const cni = res.json().data.requiredDocs.find((d: { docType: string }) => d.docType === "cni")
    expect(cni.status).toBe("infected")
    expect(res.json().data.legalVerificationStatus).toBe("pending")
    expect((await orderStatusInDb(orderId)).status).toBe("pending")
  })

  it("only recomputes orders of the document owner", async () => {
    const mine = await seedOrder(customerId, ["D"])
    const theirs = await seedOrder(otherId, ["D"])
    const docId = await uploadDoc("cni")
    await decide(docId, "approve")

    expect((await orderStatusInDb(mine)).status).toBe("docs_verified")
    expect((await orderStatusInDb(theirs)).status).toBe("pending")
  })
})
