import { createHash } from "node:crypto"
import { eq, inArray } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { addresses, auditLogs, legalDocuments, newsletterContacts, newsletterSubscriptions } from "../db/schema.js"
import { ACCOUNT_PASSWORD, createAccount, createOrder, deleteAccounts } from "../test/account-fixtures.js"

const EMAIL_SUFFIX = "@account-export.local"

describe("the export of an account's data (story 12.11)", () => {
  let app: FastifyInstance
  const contactIds: string[] = []

  const exportFor = (token: string | null, payload: object) =>
    app.inject({
      method: "POST",
      url: "/api/auth/me/export",
      ...(token && { headers: { authorization: `Bearer ${token}` } }),
      payload,
    })

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    if (contactIds.length > 0) await db.delete(newsletterContacts).where(inArray(newsletterContacts.id, contactIds))
    await deleteAccounts(EMAIL_SUFFIX)
    await app.close()
  })

  it("needs a session", async () => {
    const res = await exportFor(null, { password: ACCOUNT_PASSWORD })
    expect(res.statusCode).toBe(401)
  })

  it("asks for the password again, and refuses a wrong one", async () => {
    const account = await createAccount(app, EMAIL_SUFFIX)
    const res = await exportFor(account.token, { password: "not-the-password" })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe("InvalidCredentials")
  })

  it("asks for the app's code too when the account has the app on", async () => {
    const account = await createAccount(app, EMAIL_SUFFIX, { withApp: true })

    const withoutCode = await exportFor(account.token, { password: ACCOUNT_PASSWORD })
    expect(withoutCode.statusCode).toBe(400)
    expect(withoutCode.json().error).toBe("TotpCodeRequired")

    const wrongCode = await exportFor(account.token, { password: ACCOUNT_PASSWORD, code: "000000" })
    expect(wrongCode.statusCode).toBe(400)
    expect(wrongCode.json().error).toBe("InvalidTotpCode")

    const withCode = await exportFor(account.token, { password: ACCOUNT_PASSWORD, code: account.appCode?.() })
    expect(withCode.statusCode).toBe(200)
  })

  it("hands over everything the account holds, as a dated JSON file", async () => {
    const account = await createAccount(app, EMAIL_SUFFIX)
    const someoneElse = await createAccount(app, EMAIL_SUFFIX)
    await db.insert(addresses).values({
      userId: account.id,
      label: "Domicile",
      firstName: "Jeanne",
      lastName: "Armand",
      line1: "12 rue des Lilas",
      postal: "75011",
      city: "Paris",
    })
    const order = await createOrder(account.id, {
      termsVersion: "2026-09-29",
      termsAcceptedAt: new Date("2026-02-01T10:00:00Z"),
    })
    await createOrder(someoneElse.id)
    await db.insert(legalDocuments).values({
      userId: account.id,
      docType: "permis_chasse",
      docNumber: "PC-123456",
      s3Key: "legal/secret-key.pdf",
      s3Url: "https://bucket.example/legal/secret-key.pdf",
      verificationStatus: "approved",
    })
    const [contact] = await db
      .insert(newsletterContacts)
      .values({ email: account.email, emailHash: createHash("sha256").update(account.email).digest("hex") })
      .returning({ id: newsletterContacts.id })
    contactIds.push(contact.id)
    await db.insert(newsletterSubscriptions).values({
      contactId: contact.id,
      segment: "armurerie",
      status: "confirmed",
      confirmedAt: new Date("2026-03-01T10:00:00Z"),
      consentIp: "203.0.113.7",
    })

    const res = await exportFor(account.token, { password: ACCOUNT_PASSWORD })

    expect(res.statusCode).toBe(200)
    expect(res.headers["content-type"]).toContain("application/json")
    expect(res.headers["content-disposition"]).toMatch(
      /^attachment; filename="scs-firearms-mes-donnees-\d{4}-\d{2}-\d{2}\.json"$/,
    )
    expect(res.headers["cache-control"]).toBe("no-store")

    const data = res.json()
    expect(data.account).toMatchObject({
      email: account.email,
      firstName: "Jeanne",
      lastName: "Armand",
      phone: "+33612345678",
      address: { street: "12 rue des Lilas", postal: "75011", city: "Paris", country: "FR" },
      twoFactorEnabled: false,
    })
    expect(data.consents.privacyPolicy.acceptedAt).toBe("2026-01-15T10:00:00.000Z")
    expect(data.addresses).toHaveLength(1)
    expect(data.addresses[0]).toMatchObject({ label: "Domicile", line1: "12 rue des Lilas", city: "Paris" })
    expect(data.orders).toHaveLength(1)
    expect(data.orders[0]).toMatchObject({ id: order.id, totalTtc: "120.00", termsVersion: "2026-09-29" })
    expect(data.legalDocuments).toEqual([
      expect.objectContaining({ type: "permis_chasse", number: "PC-123456", status: "approved" }),
    ])
    expect(data.newsletter).toEqual([
      expect.objectContaining({ segment: "armurerie", status: "confirmed", consentIp: "203.0.113.7" }),
    ])
    expect(data.quoteRequests).toEqual([])

    // Never a secret, an internal storage key, nor anyone else's data.
    const raw = res.body
    expect(raw).not.toMatch(/passwordHash|password_hash|totpSecret|\$argon2/)
    expect(raw).not.toContain("secret-key")
    expect(raw).not.toContain(someoneElse.id)
  })

  it("is journaled on the account", async () => {
    const account = await createAccount(app, EMAIL_SUFFIX)
    await exportFor(account.token, { password: ACCOUNT_PASSWORD })
    const events = await db.select().from(auditLogs).where(eq(auditLogs.entityId, account.id))
    expect(events.map((event) => event.action)).toContain("user.data_exported")
  })
})
