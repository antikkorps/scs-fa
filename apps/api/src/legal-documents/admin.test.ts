import { CURRENT_RGPD_CONSENT_VERSION, LEGAL_DOC_REVIEW_SLA_HOURS } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import FormData from "form-data"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, legalDocuments, users } from "../db/schema.js"
import { sendLegalDocApprovedEmail, sendLegalDocRejectedEmail } from "../email.js"

vi.mock("../email.js", () => ({
  sendLegalDocApprovedEmail: vi.fn().mockResolvedValue(undefined),
  sendLegalDocRejectedEmail: vi.fn().mockResolvedValue(undefined),
}))

const PASSWORD = "MotDePasseTresLong123!"
const ADMIN_EMAIL = "legaladmin-test-admin@legaladmin-test.local"
const CUSTOMER_EMAIL = "legaladmin-test-customer@legaladmin-test.local"
const CUSTOMER_2_EMAIL = "legaladmin-test-customer2@legaladmin-test.local"

const PDF = Buffer.from("%PDF-1.4\n%fake pdf for tests\n")
const HOUR_MS = 60 * 60 * 1000

describe("admin legal document validation (/api/admin/legal-documents)", () => {
  let app: FastifyInstance
  let adminToken: string
  let adminId: string
  let customerToken: string
  let customerId: string
  let customer2Id: string

  async function cleanup() {
    const userIds = db.select({ id: users.id }).from(users).where(like(users.email, "legaladmin-test%"))
    await db.delete(legalDocuments).where(inArray(legalDocuments.userId, userIds))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
    await db.delete(users).where(like(users.email, "legaladmin-test%"))
  }

  async function makeUser(email: string, role: "customer" | "admin") {
    const passwordHash = await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
    const [u] = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        role,
        firstname: "Test",
        lastname: role === "admin" ? "Admin" : "Customer",
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id })
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } })
    return { id: u.id, token: login.json().accessToken as string }
  }

  /** Insert a document row directly (bypasses upload) with full control over statuses/deadline. */
  async function seedDoc(
    overrides: Partial<typeof legalDocuments.$inferInsert> & { userId: string; docType: string } = {
      userId: customerId,
      docType: "cni",
    },
  ) {
    const [row] = await db
      .insert(legalDocuments)
      .values({
        s3Key: `legal-documents/${overrides.userId}/test.pdf`,
        s3Url: `memory://legal-documents/${overrides.userId}/test.pdf`,
        mimeType: "application/pdf",
        fileSize: PDF.length,
        scanStatus: "clean",
        verificationStatus: "pending",
        verificationDeadline: new Date(Date.now() + LEGAL_DOC_REVIEW_SLA_HOURS * HOUR_MS),
        ...overrides,
      } as typeof legalDocuments.$inferInsert)
      .returning()
    return row
  }

  function adminGet(url: string, token = adminToken) {
    return app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } })
  }

  function decide(id: string, verb: "approve" | "reject", body?: object, token = adminToken) {
    return app.inject({
      method: "POST",
      url: `/api/admin/legal-documents/${id}/${verb}`,
      headers: { authorization: `Bearer ${token}` },
      payload: body ?? {},
    })
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()
    const admin = await makeUser(ADMIN_EMAIL, "admin")
    adminId = admin.id
    adminToken = admin.token
    const customer = await makeUser(CUSTOMER_EMAIL, "customer")
    customerId = customer.id
    customerToken = customer.token
    const customer2 = await makeUser(CUSTOMER_2_EMAIL, "customer")
    customer2Id = customer2.id
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    await db.delete(legalDocuments).where(inArray(legalDocuments.userId, [customerId, customer2Id]))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, [adminId]))
  })

  // ── Access control ────────────────────────────────────────────────────────

  it("requires authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/api/admin/legal-documents" })
    expect(res.statusCode).toBe(401)
  })

  it("forbids non-admin users on every admin route", async () => {
    const doc = await seedDoc({ userId: customerId, docType: "cni" })
    const list = await adminGet("/api/admin/legal-documents", customerToken)
    expect(list.statusCode).toBe(403)
    const detail = await adminGet(`/api/admin/legal-documents/${doc.id}`, customerToken)
    expect(detail.statusCode).toBe(403)
    const approve = await decide(doc.id, "approve", {}, customerToken)
    expect(approve.statusCode).toBe(403)
    const reject = await decide(doc.id, "reject", { reason: "document_expired" }, customerToken)
    expect(reject.statusCode).toBe(403)
  })

  // ── Queue ─────────────────────────────────────────────────────────────────

  it("lists the pending queue ordered by closest SLA deadline first", async () => {
    const far = await seedDoc({
      userId: customerId,
      docType: "cni",
      verificationDeadline: new Date(Date.now() + 40 * HOUR_MS),
    })
    const near = await seedDoc({
      userId: customer2Id,
      docType: "permis_chasse",
      verificationDeadline: new Date(Date.now() + 2 * HOUR_MS),
    })
    const overdue = await seedDoc({
      userId: customerId,
      docType: "sia",
      verificationDeadline: new Date(Date.now() - 3 * HOUR_MS),
    })
    // Decided documents stay out of the default queue
    await seedDoc({ userId: customer2Id, docType: "autorisation_det", verificationStatus: "approved" })

    const res = await adminGet("/api/admin/legal-documents")
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data.map((d: { id: string }) => d.id)).toEqual([overdue.id, near.id, far.id])
  })

  it("flags overdue documents and exposes the uploader identity", async () => {
    await seedDoc({
      userId: customerId,
      docType: "cni",
      verificationDeadline: new Date(Date.now() - 1 * HOUR_MS),
    })
    const res = await adminGet("/api/admin/legal-documents")
    const [doc] = res.json().data
    expect(doc.overdue).toBe(true)
    expect(doc.user).toMatchObject({ id: customerId, email: CUSTOMER_EMAIL })
    expect(doc.user.passwordHash).toBeUndefined()
  })

  it("filters by verification status", async () => {
    await seedDoc({ userId: customerId, docType: "cni" })
    const approved = await seedDoc({ userId: customerId, docType: "permis_chasse", verificationStatus: "approved" })

    const res = await adminGet("/api/admin/legal-documents?status=approved")
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe(approved.id)
  })

  it("rejects an invalid status filter", async () => {
    const res = await adminGet("/api/admin/legal-documents?status=bogus")
    expect(res.statusCode).toBe(400)
  })

  it("paginates the queue", async () => {
    await seedDoc({ userId: customerId, docType: "cni" })
    await seedDoc({ userId: customerId, docType: "permis_chasse" })
    await seedDoc({ userId: customerId, docType: "sia" })

    const res = await adminGet("/api/admin/legal-documents?page=2&limit=2")
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(1)
    expect(body.pagination).toMatchObject({ page: 2, limit: 2, total: 3, totalPages: 2, hasMore: false })
  })

  // ── Detail ────────────────────────────────────────────────────────────────

  it("returns document detail with a download URL", async () => {
    // Upload through the real endpoint so the object exists in storage
    const form = new FormData()
    form.append("docType", "cni")
    form.append("file", PDF, { filename: "cni.pdf", contentType: "application/pdf" })
    const uploaded = await app.inject({
      method: "POST",
      url: "/api/legal-documents",
      headers: { authorization: `Bearer ${customerToken}`, ...form.getHeaders() },
      payload: form,
    })
    const docId = uploaded.json().data.id

    const res = await adminGet(`/api/admin/legal-documents/${docId}`)
    expect(res.statusCode).toBe(200)
    expect(typeof res.json().data.downloadUrl).toBe("string")
    expect(res.json().data.user.email).toBe(CUSTOMER_EMAIL)
  })

  it("returns 404 for an unknown document", async () => {
    const res = await adminGet("/api/admin/legal-documents/00000000-0000-0000-0000-000000000000")
    expect(res.statusCode).toBe(404)
  })

  // ── Approve ───────────────────────────────────────────────────────────────

  it("approves a clean pending document, audits and notifies", async () => {
    const doc = await seedDoc({ userId: customerId, docType: "cni" })
    const res = await decide(doc.id, "approve")
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ verificationStatus: "approved", verifiedBy: adminId })
    expect(res.json().data.verifiedAt).not.toBeNull()

    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.entityId, doc.id))
    expect(audit).toMatchObject({
      entityType: "legal_document",
      action: "legal_doc_approved",
      userId: adminId,
      userRole: "admin",
    })

    expect(sendLegalDocApprovedEmail).toHaveBeenCalledWith(CUSTOMER_EMAIL, expect.objectContaining({ docType: "cni" }))
  })

  it("refuses to approve a document whose antivirus scan is not clean", async () => {
    const pendingScan = await seedDoc({ userId: customerId, docType: "cni", scanStatus: "pending" })
    const res = await decide(pendingScan.id, "approve")
    expect(res.statusCode).toBe(409)
    expect(sendLegalDocApprovedEmail).not.toHaveBeenCalled()
  })

  it("refuses to approve an already-decided document", async () => {
    const doc = await seedDoc({ userId: customerId, docType: "cni", verificationStatus: "rejected" })
    const res = await decide(doc.id, "approve")
    expect(res.statusCode).toBe(409)
  })

  // ── Reject ────────────────────────────────────────────────────────────────

  it("rejects a document with a standardized reason, audits and notifies", async () => {
    const doc = await seedDoc({ userId: customerId, docType: "permis_chasse" })
    const res = await decide(doc.id, "reject", { reason: "document_expired", notes: "Permit expired in 2023" })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({
      verificationStatus: "rejected",
      rejectionReason: "document_expired",
      verificationNotes: "Permit expired in 2023",
      verifiedBy: adminId,
    })

    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.entityId, doc.id))
    expect(audit).toMatchObject({ action: "legal_doc_rejected", reason: "document_expired" })

    expect(sendLegalDocRejectedEmail).toHaveBeenCalledWith(
      CUSTOMER_EMAIL,
      expect.objectContaining({ docType: "permis_chasse", reason: "document_expired" }),
    )
  })

  it("rejects an unknown rejection reason", async () => {
    const doc = await seedDoc({ userId: customerId, docType: "cni" })
    const res = await decide(doc.id, "reject", { reason: "because" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe("ValidationError")
  })

  it('requires notes when the reason is "other"', async () => {
    const doc = await seedDoc({ userId: customerId, docType: "cni" })
    const res = await decide(doc.id, "reject", { reason: "other" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe("ValidationError")
    expect(sendLegalDocRejectedEmail).not.toHaveBeenCalled()
  })

  it("refuses to reject an already-decided document", async () => {
    const doc = await seedDoc({ userId: customerId, docType: "cni", verificationStatus: "approved" })
    const res = await decide(doc.id, "reject", { reason: "document_illegible" })
    expect(res.statusCode).toBe(409)
  })

  it("can reject a document even when its scan is not clean", async () => {
    const infected = await seedDoc({ userId: customerId, docType: "cni", scanStatus: "infected" })
    const res = await decide(infected.id, "reject", { reason: "suspected_fraud" })
    expect(res.statusCode).toBe(200)
  })

  // ── SLA deadline on upload ────────────────────────────────────────────────

  it("sets a 48h verification deadline at upload time", async () => {
    const form = new FormData()
    form.append("docType", "autorisation_det")
    form.append("file", PDF, { filename: "det.pdf", contentType: "application/pdf" })
    const res = await app.inject({
      method: "POST",
      url: "/api/legal-documents",
      headers: { authorization: `Bearer ${customerToken}`, ...form.getHeaders() },
      payload: form,
    })
    expect(res.statusCode).toBe(201)

    const [row] = await db
      .select({ deadline: legalDocuments.verificationDeadline })
      .from(legalDocuments)
      .where(eq(legalDocuments.id, res.json().data.id))
    expect(row.deadline).not.toBeNull()
    const expected = Date.now() + LEGAL_DOC_REVIEW_SLA_HOURS * HOUR_MS
    expect(Math.abs((row.deadline as Date).getTime() - expected)).toBeLessThan(60_000)
  })
})
