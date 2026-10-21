import { CURRENT_RGPD_CONSENT_VERSION, type OrganisationType } from "@armurier/shared"
import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, organisations, users } from "../db/schema.js"
import {
  sendOrganisationApprovedEmail,
  sendOrganisationReinstatedEmail,
  sendOrganisationRejectedEmail,
  sendOrganisationSuspendedEmail,
} from "../email.js"

vi.mock("../email.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../email.js")>()),
  sendOrganisationApprovedEmail: vi.fn().mockResolvedValue(undefined),
  sendOrganisationRejectedEmail: vi.fn().mockResolvedValue(undefined),
  sendOrganisationSuspendedEmail: vi.fn().mockResolvedValue(undefined),
  sendOrganisationReinstatedEmail: vi.fn().mockResolvedValue(undefined),
}))

const EMAIL_SUFFIX = "@pro-admin.local"

let siretCounter = 0
/** Unique per run; the admin routes never re-check the key. */
const nextSiret = () => `8${String(Date.now()).slice(-9)}${String(siretCounter++).padStart(4, "0")}`

describe("pro accounts in the back-office (/api/admin/organisations, story 12.8b)", () => {
  let app: FastifyInstance
  let adminId: string
  let adminToken: string

  async function account(role: "customer" | "admin", organisationId: string | null = null) {
    const [row] = await db
      .insert(users)
      .values({
        email: `${role}-${Date.now()}-${Math.random()}${EMAIL_SUFFIX}`,
        passwordHash: "$argon2id$unused",
        role,
        firstname: "Jeanne",
        lastname: "Armand",
        organisationId,
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id, email: users.email })
    return { ...row, token: app.jwt.sign({ sub: row.id, role }) }
  }

  async function proRequest(
    overrides: { type?: OrganisationType; status?: "pending" | "approved" | "rejected" | "suspended" } = {},
  ) {
    const [organisation] = await db
      .insert(organisations)
      .values({
        legalName: "Armurerie Armand",
        siret: nextSiret(),
        type: overrides.type ?? "armurier",
        status: overrides.status ?? "pending",
        registryCheck: "verified",
        registrySnapshot: { legalName: "ARMURERIE ARMAND", active: true },
      })
      .returning()
    const member = await account("customer", organisation.id)
    return { organisation, member }
  }

  const call = (method: "GET" | "POST" | "PATCH", url: string, payload?: object, token = adminToken) =>
    app.inject({
      method,
      url: `/api/admin/organisations${url}`,
      headers: { authorization: `Bearer ${token}` },
      ...(payload ? { payload } : {}),
    })

  const stored = async (id: string) => (await db.select().from(organisations).where(eq(organisations.id, id)))[0]
  const actions = async (id: string) =>
    (await db.select().from(auditLogs).where(eq(auditLogs.entityId, id))).map((event) => event.action)

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    const admin = await account("admin")
    adminId = admin.id
    adminToken = admin.token
  })

  afterAll(() => app.close())

  afterEach(async () => {
    const testUsers = await db
      .select({ id: users.id, organisationId: users.organisationId })
      .from(users)
      .where(like(users.email, `%${EMAIL_SUFFIX}`))
    const userIds = testUsers.map((row) => row.id)
    const organisationIds = testUsers.flatMap((row) => (row.organisationId ? [row.organisationId] : []))
    if (organisationIds.length > 0) {
      await db.delete(auditLogs).where(inArray(auditLogs.entityId, organisationIds))
      await db.update(users).set({ organisationId: null }).where(inArray(users.id, userIds))
      await db.delete(organisations).where(inArray(organisations.id, organisationIds))
    }
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
    await db.delete(users).where(inArray(users.id, userIds))
  })

  it("is for admins only", async () => {
    const { member } = await proRequest()
    expect((await call("GET", "/", undefined, member.token)).statusCode).toBe(403)
    expect((await app.inject({ method: "GET", url: "/api/admin/organisations" })).statusCode).toBe(401)
  })

  describe("GET / and GET /:id", () => {
    it("lists requests by status with their member, newest first", async () => {
      const older = await proRequest()
      const newer = await proRequest()
      await proRequest({ status: "approved" })

      const res = await call("GET", "/?status=pending&limit=100")

      expect(res.statusCode).toBe(200)
      const ids = res.json().data.map((row: { id: string }) => row.id)
      expect(ids.indexOf(newer.organisation.id)).toBeLessThan(ids.indexOf(older.organisation.id))
      expect(res.json().data.every((row: { status: string }) => row.status === "pending")).toBe(true)
      expect(res.json().data.find((row: { id: string }) => row.id === older.organisation.id)).toMatchObject({
        legalName: "Armurerie Armand",
        registryCheck: "verified",
        member: { email: older.member.email, firstName: "Jeanne", lastName: "Armand" },
      })
      expect(res.json().pagination).toMatchObject({ page: 1, limit: 100 })
    })

    it("shows one request with the registry's answer and the terms", async () => {
      const { organisation, member } = await proRequest()

      const res = await call("GET", `/${organisation.id}`)

      expect(res.json().data).toMatchObject({
        id: organisation.id,
        registrySnapshot: { legalName: "ARMURERIE ARMAND" },
        discountPct: 0,
        net30Allowed: false,
        showPrices: false,
        member: { id: member.id, email: member.email },
      })
      expect((await call("GET", `/${crypto.randomUUID()}`)).statusCode).toBe(404)
    })
  })

  describe("POST /:id/approve", () => {
    it("approves a pending request, records who and when, and mails the member", async () => {
      const { organisation, member } = await proRequest()

      const res = await call("POST", `/${organisation.id}/approve`, { discountPct: 12.5, showPrices: true })

      expect(res.statusCode).toBe(200)
      const row = await stored(organisation.id)
      expect(row).toMatchObject({
        status: "approved",
        reviewedBy: adminId,
        discountPct: "12.50",
        showPrices: true,
        net30Allowed: false,
      })
      expect(row?.reviewedAt).toBeInstanceOf(Date)
      expect(await actions(organisation.id)).toEqual(["organisation.approved"])
      expect(sendOrganisationApprovedEmail).toHaveBeenCalledWith(
        member.email,
        { legalName: "Armurerie Armand" },
        { userId: member.id },
      )
    })

    it("allows administrations the 30-day payment unless told otherwise", async () => {
      const administration = await proRequest({ type: "administration" })
      await call("POST", `/${administration.organisation.id}/approve`, {})
      expect((await stored(administration.organisation.id))?.net30Allowed).toBe(true)

      const declined = await proRequest({ type: "administration" })
      await call("POST", `/${declined.organisation.id}/approve`, { net30Allowed: false })
      expect((await stored(declined.organisation.id))?.net30Allowed).toBe(false)
    })

    it("refuses to approve anything but a pending request", async () => {
      const { organisation } = await proRequest({ status: "suspended" })
      const res = await call("POST", `/${organisation.id}/approve`, {})
      expect(res.statusCode).toBe(409)
      expect(res.json().error).toBe("InvalidStatusTransition")
      expect(sendOrganisationApprovedEmail).not.toHaveBeenCalled()
    })
  })

  describe("refusal, suspension, reinstatement", () => {
    it("refuses a pending request with a reason, mailed as written", async () => {
      const { organisation, member } = await proRequest()

      const res = await call("POST", `/${organisation.id}/reject`, { reason: "SIRET d'un établissement fermé" })

      expect(res.statusCode).toBe(200)
      expect(await stored(organisation.id)).toMatchObject({
        status: "rejected",
        reviewReason: "SIRET d'un établissement fermé",
        reviewedBy: adminId,
      })
      expect(sendOrganisationRejectedEmail).toHaveBeenCalledWith(
        member.email,
        { legalName: "Armurerie Armand", reason: "SIRET d'un établissement fermé" },
        { userId: member.id },
      )
      expect(await actions(organisation.id)).toEqual(["organisation.rejected"])
    })

    it("asks for a reason to refuse or suspend", async () => {
      const { organisation } = await proRequest()
      expect((await call("POST", `/${organisation.id}/reject`, {})).statusCode).toBe(400)
      expect((await call("POST", `/${organisation.id}/reject`, { reason: "  " })).statusCode).toBe(400)
    })

    it("suspends an approved account, then reinstates it, clearing the reason", async () => {
      const { organisation, member } = await proRequest({ status: "approved" })

      await call("POST", `/${organisation.id}/suspend`, { reason: "Impayés" })
      expect(await stored(organisation.id)).toMatchObject({ status: "suspended", reviewReason: "Impayés" })
      expect(sendOrganisationSuspendedEmail).toHaveBeenCalledWith(
        member.email,
        { legalName: "Armurerie Armand", reason: "Impayés" },
        { userId: member.id },
      )

      const res = await call("POST", `/${organisation.id}/reinstate`)
      expect(res.statusCode).toBe(200)
      expect(await stored(organisation.id)).toMatchObject({ status: "approved", reviewReason: null })
      expect(sendOrganisationReinstatedEmail).toHaveBeenCalledOnce()
      expect(await actions(organisation.id)).toEqual(["organisation.suspended", "organisation.reinstated"])
    })

    it("only suspends an approved account and only reinstates a suspended one", async () => {
      const pending = await proRequest()
      expect((await call("POST", `/${pending.organisation.id}/suspend`, { reason: "Impayés" })).statusCode).toBe(409)
      expect((await call("POST", `/${pending.organisation.id}/reinstate`)).statusCode).toBe(409)
      expect((await call("POST", `/${crypto.randomUUID()}/reinstate`)).statusCode).toBe(404)
    })
  })

  describe("PATCH /:id — commercial terms", () => {
    it("changes only the terms it is given, and journals before and after", async () => {
      const { organisation } = await proRequest({ status: "approved" })

      const res = await call("PATCH", `/${organisation.id}`, { discountPct: 8 })

      expect(res.statusCode).toBe(200)
      expect(await stored(organisation.id)).toMatchObject({ discountPct: "8.00", net30Allowed: false })
      const [event] = await db.select().from(auditLogs).where(eq(auditLogs.entityId, organisation.id))
      expect(event).toMatchObject({
        action: "organisation.terms_updated",
        oldValue: { discountPct: 0 },
        newValue: { discountPct: 8 },
      })
    })

    it("refuses an empty patch, an unknown field and a discount above 100 %", async () => {
      const { organisation } = await proRequest({ status: "approved" })
      for (const payload of [{}, { status: "approved" }, { discountPct: 101 }, { discountPct: 1.234 }]) {
        expect((await call("PATCH", `/${organisation.id}`, payload)).statusCode, JSON.stringify(payload)).toBe(400)
      }
    })
  })
})
