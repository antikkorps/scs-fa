import { eq } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import FormData from "form-data"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { legalDocuments, organisations } from "../db/schema.js"
import { sendLegalDocApprovedEmail, sendLegalDocRejectedEmail, sendLegalDocSlaBreachEmail } from "../email.js"
import { expireLegalDocuments } from "../legal-documents/expiry.js"
import { scanDocument } from "../legal-documents/scan.js"
import { runLegalDocSlaBreachCheck } from "../legal-documents/sla.js"
import { type Account, proFixtures } from "../test/pro-fixtures.js"

vi.mock("../email.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../email.js")>()),
  sendLegalDocApprovedEmail: vi.fn().mockResolvedValue(undefined),
  sendLegalDocRejectedEmail: vi.fn().mockResolvedValue(undefined),
  sendLegalDocSlaBreachEmail: vi.fn().mockResolvedValue(undefined),
}))

const TAG = "orgdocs"
const PDF = Buffer.from("%PDF-1.4\n%fake pdf for tests\n")

describe("an organisation's documents (story 12.8d)", () => {
  let app: FastifyInstance
  let fixtures: ReturnType<typeof proFixtures>
  let pro: Account
  let otherPro: Account
  let admin: Account

  function upload(fields: Record<string, string>, token = pro.token) {
    const form = new FormData()
    for (const [key, value] of Object.entries(fields)) form.append(key, value)
    form.append("file", PDF, { filename: "agrement.pdf", contentType: "application/pdf" })
    return app.inject({
      method: "POST",
      url: "/api/pro/documents",
      headers: { authorization: `Bearer ${token}`, ...form.getHeaders() },
      payload: form,
    })
  }

  const call = (method: "GET" | "POST" | "DELETE", url: string, token: string, payload?: object) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload && { payload }) })

  async function uploaded(docType = "agrement_armurier") {
    const res = await upload({ docType, docNumber: "AG-2026-001" })
    expect(res.statusCode).toBe(201)
    const id = res.json().data.id as string
    await scanDocument(id)
    return id
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    fixtures = proFixtures(app, TAG)
    await fixtures.cleanup()
    pro = await fixtures.account({ organisation: "approved" })
    otherPro = await fixtures.account({ organisation: "approved" })
    admin = await fixtures.account({ role: "admin" })
  })

  beforeEach(() => {
    vi.mocked(sendLegalDocApprovedEmail).mockClear()
    vi.mocked(sendLegalDocRejectedEmail).mockClear()
  })

  afterAll(async () => {
    await fixtures.cleanup()
    await app.close()
  })

  describe("the pro's side", () => {
    it("files a document on the organisation, not on the person", async () => {
      const res = await upload({ docType: "agrement_armurier", docNumber: "AG-2026-001", expiresAt: "2030-12-31" })

      expect(res.statusCode).toBe(201)
      expect(res.json().data).toMatchObject({ docType: "agrement_armurier", verificationStatus: "pending" })
      const [row] = await db.select().from(legalDocuments).where(eq(legalDocuments.id, res.json().data.id))
      expect(row).toMatchObject({ organisationId: pro.organisationId, userId: null })
      expect(row?.s3Key).toMatch(new RegExp(`^legal-documents/organisations/${pro.organisationId}/`))
    })

    it("takes only a professional document type", async () => {
      expect((await upload({ docType: "cni" })).statusCode).toBe(400)
    })

    it("lists and shows the organisation's documents to its member only", async () => {
      const id = await uploaded()

      const list = (await call("GET", "/api/pro/documents", pro.token)).json().data
      expect(list.map((doc: { id: string }) => doc.id)).toContain(id)
      const detail = (await call("GET", `/api/pro/documents/${id}`, pro.token)).json().data
      expect(detail.downloadUrl).toEqual(expect.any(String))

      expect((await call("GET", "/api/pro/documents", otherPro.token)).json().data).toEqual([])
      expect((await call("GET", `/api/pro/documents/${id}`, otherPro.token)).statusCode).toBe(404)
      expect((await call("DELETE", `/api/pro/documents/${id}`, otherPro.token)).statusCode).toBe(404)
    })

    it("withdraws a document not yet approved, keeps an approved one", async () => {
      const pending = await uploaded()
      expect((await call("DELETE", `/api/pro/documents/${pending}`, pro.token)).statusCode).toBe(204)

      const approved = await uploaded("autorisation_commerce")
      await call("POST", `/api/admin/legal-documents/${approved}/approve`, admin.token)
      const refused = await call("DELETE", `/api/pro/documents/${approved}`, pro.token)
      expect(refused.statusCode).toBe(409)
      expect(refused.json().error).toBe("DocumentApproved")
    })
  })

  describe("SCS's review", () => {
    it("queues the organisation's documents with the organisation's name", async () => {
      const id = await uploaded("affiliation_federale")

      const queue = (await call("GET", "/api/admin/legal-documents?status=pending&limit=100", admin.token)).json().data
      const row = queue.find((doc: { id: string }) => doc.id === id)
      expect(row).toMatchObject({
        user: null,
        organisation: { id: pro.organisationId, legalName: `Armurerie ${TAG}` },
      })
    })

    it("approves it and tells the organisation's member", async () => {
      const id = await uploaded("autorisation_cnaps")

      const res = await call("POST", `/api/admin/legal-documents/${id}/approve`, admin.token)

      expect(res.statusCode).toBe(200)
      expect(sendLegalDocApprovedEmail).toHaveBeenCalledWith(
        pro.email,
        { docType: "autorisation_cnaps" },
        { userId: pro.id },
      )
    })

    it("rejects it with a reason, mailed to the member", async () => {
      const id = await uploaded("bon_de_commande")

      const res = await call("POST", `/api/admin/legal-documents/${id}/reject`, admin.token, {
        reason: "document_illegible",
      })

      expect(res.statusCode).toBe(200)
      expect(sendLegalDocRejectedEmail).toHaveBeenCalledWith(
        pro.email,
        expect.objectContaining({ docType: "bon_de_commande", reason: "document_illegible" }),
        { userId: pro.id },
      )
    })

    it("alerts SCS when an organisation's document waits past its review deadline", async () => {
      const id = await uploaded("agrement_armurier")
      await db
        .update(legalDocuments)
        .set({ verificationDeadline: new Date(Date.now() - 60 * 60 * 1000) })
        .where(eq(legalDocuments.id, id))

      await runLegalDocSlaBreachCheck()

      const [, items] = vi.mocked(sendLegalDocSlaBreachEmail).mock.calls.at(-1) ?? []
      expect(items).toContainEqual(
        expect.objectContaining({ customerName: `Armurerie ${TAG}`, docType: "agrement_armurier" }),
      )
    })

    it("expires an organisation's document past its date", async () => {
      const id = await uploaded("autorisation_prefectorale")
      await db.update(legalDocuments).set({ expiresAt: "2020-01-01" }).where(eq(legalDocuments.id, id))

      await expireLegalDocuments()

      const [row] = await db.select().from(legalDocuments).where(eq(legalDocuments.id, id))
      expect(row?.verificationStatus).toBe("expired")
    })
  })

  it("refuses an organisation not validated yet", async () => {
    await db
      .update(organisations)
      .set({ status: "pending" })
      .where(eq(organisations.id, otherPro.organisationId as string))
    expect((await upload({ docType: "agrement_armurier" }, otherPro.token)).statusCode).toBe(403)
  })
})
