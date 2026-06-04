import { CURRENT_RGPD_CONSENT_VERSION, MAX_LEGAL_DOC_SIZE_BYTES } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import FormData from "form-data"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, legalDocuments, users } from "../db/schema.js"
import { scanDocument } from "./scan.js"

const PASSWORD = "MotDePasseTresLong123!"
const EMAIL = "legaldoc-test@legaldoc-test.local"
const EMAIL_OTHER = "legaldoc-test-other@legaldoc-test.local"

const PDF = Buffer.from("%PDF-1.4\n%fake pdf for tests\n")

describe("legal documents (/api/legal-documents)", () => {
  let app: FastifyInstance
  let userId: string
  let otherUserId: string
  let token: string
  let otherToken: string

  async function cleanup() {
    const userIds = db.select({ id: users.id }).from(users).where(like(users.email, "legaldoc-test%"))
    await db.delete(legalDocuments).where(inArray(legalDocuments.userId, userIds))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
    await db.delete(users).where(like(users.email, "legaldoc-test%"))
  }

  async function makeUser(email: string) {
    const passwordHash = await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
    const [u] = await db
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
    return { id: u.id, token: login.json().accessToken as string }
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()
    const me = await makeUser(EMAIL)
    userId = me.id
    token = me.token
    const other = await makeUser(EMAIL_OTHER)
    otherUserId = other.id
    otherToken = other.token
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  beforeEach(async () => {
    await db.delete(legalDocuments).where(inArray(legalDocuments.userId, [userId, otherUserId]))
  })

  function upload(
    options: {
      fields?: Record<string, string>
      file?: { buffer: Buffer; filename: string; contentType: string }
      authToken?: string
    } = {},
  ) {
    const form = new FormData()
    for (const [k, v] of Object.entries(options.fields ?? {})) form.append(k, v)
    if (options.file) {
      form.append("file", options.file.buffer, {
        filename: options.file.filename,
        contentType: options.file.contentType,
      })
    }
    return app.inject({
      method: "POST",
      url: "/api/legal-documents",
      headers: { authorization: `Bearer ${options.authToken ?? token}`, ...form.getHeaders() },
      payload: form,
    })
  }

  const validPdf = { buffer: PDF, filename: "cni.pdf", contentType: "application/pdf" }

  it("requires authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/api/legal-documents" })
    expect(res.statusCode).toBe(401)
  })

  it("rejects a non-multipart request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/legal-documents",
      headers: { authorization: `Bearer ${token}` },
      payload: { docType: "cni" },
    })
    expect(res.statusCode).toBe(400)
  })

  it("uploads a document and reports it as pending scan", async () => {
    const res = await upload({ fields: { docType: "cni", docNumber: "AB12345" }, file: validPdf })
    expect(res.statusCode).toBe(201)
    const { data } = res.json()
    expect(data).toMatchObject({
      docType: "cni",
      docNumber: "AB12345",
      mimeType: "application/pdf",
      fileSize: PDF.length,
      scanStatus: "pending",
      verificationStatus: "pending",
    })
    expect(data.id).toBeDefined()
  })

  it("rejects an unsupported file type", async () => {
    const res = await upload({
      fields: { docType: "cni" },
      file: { buffer: Buffer.from("hello"), filename: "note.txt", contentType: "text/plain" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe("UnsupportedMediaType")
  })

  it("rejects invalid metadata", async () => {
    const res = await upload({ fields: { docType: "not-a-type" }, file: validPdf })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe("ValidationError")
  })

  it("rejects a request without a file", async () => {
    const res = await upload({ fields: { docType: "cni" } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe("BadRequest")
  })

  it("rejects a date range where expiresAt precedes issuedAt", async () => {
    const res = await upload({
      fields: { docType: "permis_chasse", issuedAt: "2025-01-10", expiresAt: "2024-01-10" },
      file: validPdf,
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe("ValidationError")
  })

  it("rejects a file larger than the size limit", async () => {
    const big = Buffer.alloc(MAX_LEGAL_DOC_SIZE_BYTES + 1024, 0x41)
    const res = await upload({
      fields: { docType: "cni" },
      file: { buffer: big, filename: "big.pdf", contentType: "application/pdf" },
    })
    expect(res.statusCode).toBe(413)
  })

  it("marks the document clean once scanned", async () => {
    const created = (await upload({ fields: { docType: "cni" }, file: validPdf })).json().data
    const result = await scanDocument(created.id)
    expect(result).toBe("clean")
    const detail = await app.inject({
      method: "GET",
      url: `/api/legal-documents/${created.id}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(detail.statusCode).toBe(200)
    expect(detail.json().data.scanStatus).toBe("clean")
    expect(detail.json().data.scannedAt).not.toBeNull()
  })

  it("lists the user's documents, newest first and scoped to the owner", async () => {
    await upload({ fields: { docType: "cni" }, file: validPdf })
    await upload({ fields: { docType: "permis_chasse" }, file: validPdf })
    await upload({ fields: { docType: "sia" }, file: validPdf, authToken: otherToken })

    const res = await app.inject({
      method: "GET",
      url: "/api/legal-documents",
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data).toHaveLength(2)
    expect(data.every((d: { docType: string }) => d.docType !== "sia")).toBe(true)
  })

  it("returns a download URL on detail and enforces ownership", async () => {
    const created = (await upload({ fields: { docType: "cni" }, file: validPdf })).json().data

    const mine = await app.inject({
      method: "GET",
      url: `/api/legal-documents/${created.id}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(mine.statusCode).toBe(200)
    expect(typeof mine.json().data.downloadUrl).toBe("string")

    const theirs = await app.inject({
      method: "GET",
      url: `/api/legal-documents/${created.id}`,
      headers: { authorization: `Bearer ${otherToken}` },
    })
    expect(theirs.statusCode).toBe(404)
  })

  it("deletes a document", async () => {
    const created = (await upload({ fields: { docType: "cni" }, file: validPdf })).json().data
    const del = await app.inject({
      method: "DELETE",
      url: `/api/legal-documents/${created.id}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(del.statusCode).toBe(204)
    const after = await app.inject({
      method: "GET",
      url: `/api/legal-documents/${created.id}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(after.statusCode).toBe(404)
  })

  it("returns 404 when deleting an unknown document", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/legal-documents/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(404)
  })
})
