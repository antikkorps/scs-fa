import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import FormData from "form-data"
import sharp from "sharp"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, users } from "../db/schema.js"

const PASSWORD = "MotDePasseTresLong123!"
const ADMIN_EMAIL = "testblogimg-admin@testblogimg.local"
const CUSTOMER_EMAIL = "testblogimg-cust@testblogimg.local"

describe("blog images API (Story 9.4b)", () => {
  let app: FastifyInstance
  let adminToken: string
  let customerToken: string
  let png: Buffer

  async function cleanup() {
    const userIds = db.select({ id: users.id }).from(users).where(like(users.email, "testblogimg-%"))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
    await db.delete(users).where(like(users.email, "testblogimg-%"))
  }

  async function makeUser(email: string, role: "customer" | "admin") {
    const passwordHash = await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
    await db.insert(users).values({
      email,
      passwordHash,
      role,
      firstname: "Test",
      lastname: role === "admin" ? "Admin" : "Client",
      rgpdConsentAt: new Date(),
      rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
    })
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } })
    return login.json().accessToken as string
  }

  function uploadImage(buffer: Buffer, contentType: string, token = adminToken, filename = "pic.png") {
    const form = new FormData()
    form.append("file", buffer, { filename, contentType })
    return app.inject({
      method: "POST",
      url: "/api/admin/blog/images",
      headers: { authorization: `Bearer ${token}`, ...form.getHeaders() },
      payload: form,
    })
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()
    adminToken = await makeUser(ADMIN_EMAIL, "admin")
    customerToken = await makeUser(CUSTOMER_EMAIL, "customer")
    png = await sharp({ create: { width: 12, height: 8, channels: 3, background: { r: 200, g: 160, b: 90 } } })
      .png()
      .toBuffer()
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it("rejects non-admins (403 customer / 401 anonymous)", async () => {
    expect((await uploadImage(png, "image/png", customerToken)).statusCode).toBe(403)
    const anon = await app.inject({ method: "POST", url: "/api/admin/blog/images" })
    expect(anon.statusCode).toBe(401)
  })

  it("converts an uploaded PNG to WebP and serves it publicly", async () => {
    const res = await uploadImage(png, "image/png")
    expect(res.statusCode).toBe(201)
    const url = res.json().data.url as string
    expect(url).toMatch(/^\/api\/blog\/images\/[0-9a-f-]{36}\.webp$/)

    // The stored asset is reachable without auth and is real WebP.
    const served = await app.inject({ method: "GET", url })
    expect(served.statusCode).toBe(200)
    expect(served.headers["content-type"]).toContain("image/webp")
    const bytes = served.rawPayload
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF")
    expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP")
  })

  it("rejects a non-image payload and a disallowed type", async () => {
    expect((await uploadImage(Buffer.from("not an image"), "image/png")).statusCode).toBe(400)
    const pdf = Buffer.from("%PDF-1.4\n")
    expect((await uploadImage(pdf, "application/pdf", adminToken, "x.pdf")).statusCode).toBe(400)
  })

  it("404s on a malformed filename and an unknown image", async () => {
    expect((await app.inject({ method: "GET", url: "/api/blog/images/..%2f..%2fetc" })).statusCode).toBe(404)
    expect(
      (await app.inject({ method: "GET", url: "/api/blog/images/00000000-0000-0000-0000-000000000000.webp" }))
        .statusCode,
    ).toBe(404)
  })
})
