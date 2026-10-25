import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { buildApp } from "../app.js"
import { generateRefreshToken, hashRefreshToken } from "../auth/tokens.js"
import { db } from "../db/client.js"
import { auditLogs, organisations, refreshTokens, users } from "../db/schema.js"
import { sendOrganisationRequestAlertEmail, sendOrganisationRequestReceivedEmail } from "../email.js"
import { lookUpEstablishment, type RegistryLookup } from "./registry.js"

vi.mock("./registry.js", () => ({ lookUpEstablishment: vi.fn() }))
vi.mock("../email.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../email.js")>()),
  sendOrganisationRequestReceivedEmail: vi.fn().mockResolvedValue(undefined),
  sendOrganisationRequestAlertEmail: vi.fn().mockResolvedValue(undefined),
}))

const EMAIL_SUFFIX = "@pro-signup.local"
const PASSWORD = "MotDePasseTresLong123!"
const DAY_MS = 24 * 60 * 60 * 1000

/** A fresh, well-keyed SIRET: test files share the database, so no fixed number. */
function newSiret(): string {
  const body = `9${String(Math.floor(Math.random() * 1e12)).padStart(12, "0")}`
  for (let key = 0; key <= 9; key++) {
    const candidate = `${body}${key}`
    let total = 0
    for (let i = 0; i < 14; i++) {
      let digit = Number(candidate[13 - i])
      if (i % 2 === 1) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2
      total += digit
    }
    if (total % 10 === 0) return candidate
  }
  throw new Error("unreachable")
}

function found(siret: string, overrides: { active?: boolean; legalNature?: string } = {}): RegistryLookup {
  return {
    status: "found",
    establishment: {
      siret,
      legalName: "ARMURERIE DU REGISTRE",
      legalNature: overrides.legalNature ?? "5710",
      activityCode: "47.78C",
      address: "1 RUE DU STAND 69001 LYON",
      billingAddress: { line1: "1 RUE DU STAND", postal: "69001", city: "LYON" },
      active: overrides.active ?? true,
    },
  }
}

describe("pro accounts — signup and requests (story 12.8b)", () => {
  let app: FastifyInstance
  const registry = vi.mocked(lookUpEstablishment)

  const signupPayload = (siret: string, email = `pro-${Date.now()}-${Math.random()}${EMAIL_SUFFIX}`) => ({
    email,
    password: PASSWORD,
    firstName: "Jeanne",
    lastName: "Armand",
    rgpdConsent: true,
    siret,
    legalName: "Armurerie Armand",
    organisationType: "armurier",
  })

  const signup = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/organisations/signup", payload })

  async function customer(role: "customer" | "admin" = "customer") {
    const [row] = await db
      .insert(users)
      .values({
        email: `${role}-${Date.now()}-${Math.random()}${EMAIL_SUFFIX}`,
        passwordHash: await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
        role,
        firstname: "Paul",
        lastname: "Client",
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id, email: users.email })
    const token = app.jwt.sign({ sub: row.id, role })
    return { ...row, token }
  }

  const organisationOf = async (userId: string) => {
    const [row] = await db
      .select({ organisation: organisations })
      .from(users)
      .innerJoin(organisations, eq(organisations.id, users.organisationId))
      .where(eq(users.id, userId))
    return row?.organisation
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(() => app.close())

  beforeEach(() => {
    vi.clearAllMocks()
    registry.mockImplementation(async (siret) => found(siret))
  })

  afterEach(async () => {
    const testUsers = await db
      .select({ id: users.id, organisationId: users.organisationId })
      .from(users)
      .where(like(users.email, `%${EMAIL_SUFFIX}`))
    const userIds = testUsers.map((row) => row.id)
    const organisationIds = testUsers.flatMap((row) => (row.organisationId ? [row.organisationId] : []))
    if (userIds.length > 0) {
      await db.delete(refreshTokens).where(inArray(refreshTokens.userId, userIds))
      await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
      await db.delete(users).where(inArray(users.id, userIds))
    }
    if (organisationIds.length > 0) {
      await db.delete(auditLogs).where(inArray(auditLogs.entityId, organisationIds))
      await db.delete(organisations).where(inArray(organisations.id, organisationIds))
    }
  })

  describe("GET /api/organisations/lookup", () => {
    it("pre-fills the legal name and proposes administration for a public-law entity", async () => {
      const siret = newSiret()
      registry.mockResolvedValueOnce(found(siret, { legalNature: "7210" }))

      const res = await app.inject({ method: "GET", url: `/api/organisations/lookup?siret=${siret}` })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({
        data: { status: "found", legalName: "ARMURERIE DU REGISTRE", suggestedType: "administration", active: true },
      })
    })

    it("tells the form when the registry cannot answer", async () => {
      registry.mockResolvedValueOnce({ status: "unavailable" })
      const res = await app.inject({ method: "GET", url: `/api/organisations/lookup?siret=${newSiret()}` })
      expect(res.json()).toEqual({ data: { status: "unavailable" } })
    })

    it("refuses a malformed SIRET without asking the registry", async () => {
      const res = await app.inject({ method: "GET", url: "/api/organisations/lookup?siret=12345678901234" })
      expect(res.statusCode).toBe(400)
      expect(registry).not.toHaveBeenCalled()
    })
  })

  describe("POST /api/organisations/signup", () => {
    it("creates the account and its pending organisation, with what the registry said", async () => {
      const siret = newSiret()
      const payload = signupPayload(siret)

      const res = await signup({ ...payload, siret: `${siret.slice(0, 3)} ${siret.slice(3)}` })

      expect(res.statusCode).toBe(201)
      const body = res.json().data
      expect(body).toMatchObject({ email: payload.email, organisation: { status: "pending", siret } })
      const organisation = await organisationOf(body.id)
      expect(organisation).toMatchObject({
        legalName: "Armurerie Armand",
        siret,
        type: "armurier",
        status: "pending",
        registryCheck: "verified",
        discountPct: "0.00",
        net30Allowed: false,
        showPrices: false,
      })
      expect(organisation?.registrySnapshot).toMatchObject({ legalName: "ARMURERIE DU REGISTRE", active: true })
      // Story 12.8d — the billing address starts from the registry's.
      expect(organisation).toMatchObject({
        billingLine1: "1 RUE DU STAND",
        billingLine2: null,
        billingPostal: "69001",
        billingCity: "LYON",
        billingCountry: "FR",
      })
      const [user] = await db.select().from(users).where(eq(users.id, body.id))
      expect(user?.role).toBe("customer")
      expect(user?.passwordHash.startsWith("$argon2id$")).toBe(true)
    })

    it("journals the request and mails the applicant and SCS", async () => {
      const res = await signup(signupPayload(newSiret()))
      const { id, email, organisation } = res.json().data

      const events = await db.select().from(auditLogs).where(eq(auditLogs.entityId, organisation.id))
      expect(events.map((event) => event.action)).toEqual(["organisation.requested"])
      expect(events[0]?.userId).toBe(id)
      expect(sendOrganisationRequestReceivedEmail).toHaveBeenCalledWith(
        email,
        { legalName: "Armurerie Armand" },
        { userId: id },
      )
      expect(sendOrganisationRequestAlertEmail).toHaveBeenCalledOnce()
    })

    it("takes the request when the registry is down, flagged unverified", async () => {
      registry.mockResolvedValueOnce({ status: "unavailable" })
      const res = await signup(signupPayload(newSiret()))

      expect(res.statusCode).toBe(201)
      const organisation = await organisationOf(res.json().data.id)
      expect(organisation?.registryCheck).toBe("unavailable")
      expect(organisation?.registrySnapshot).toBeNull()
      expect(organisation?.billingLine1).toBeNull()
    })

    it("flags a closed establishment and an unknown number", async () => {
      const closed = newSiret()
      registry.mockResolvedValueOnce(found(closed, { active: false }))
      const closedRes = await signup(signupPayload(closed))
      expect((await organisationOf(closedRes.json().data.id))?.registryCheck).toBe("inactive")

      registry.mockResolvedValueOnce({ status: "not_found" })
      const unknownRes = await signup(signupPayload(newSiret()))
      expect((await organisationOf(unknownRes.json().data.id))?.registryCheck).toBe("not_found")
    })

    it("refuses a SIRET whose key is wrong, on the siret field", async () => {
      const res = await signup({ ...signupPayload(newSiret()), siret: "12345678901234" })
      expect(res.statusCode).toBe(400)
      expect(res.json().issues.map((issue: { path: string }) => issue.path)).toContain("siret")
      expect(registry).not.toHaveBeenCalled()
    })

    it("refuses a taken e-mail and leaves no organisation behind", async () => {
      const first = signupPayload(newSiret())
      await signup(first)
      const siret = newSiret()

      const res = await signup({ ...signupPayload(siret), email: first.email })

      expect(res.statusCode).toBe(409)
      expect(res.json().error).toBe("EmailAlreadyRegistered")
      expect(await db.select().from(organisations).where(eq(organisations.siret, siret))).toHaveLength(0)
    })

    // Story 12.9g — a first claimant must not lock the real company out: only a
    // validated organisation (approved, or suspended) holds its SIRET.
    it("lets pending requests share a SIRET, and refuses only one a validated organisation holds", async () => {
      const siret = newSiret()
      const first = await signup(signupPayload(siret))
      const second = await signup(signupPayload(siret))
      expect([first.statusCode, second.statusCode]).toEqual([201, 201])

      const firstId = first.json().data.organisation.id
      await db.update(organisations).set({ status: "approved" }).where(eq(organisations.id, firstId))
      const refused = await signup(signupPayload(siret))
      expect(refused.statusCode).toBe(409)
      expect(refused.json().error).toBe("SiretAlreadyRegistered")

      await db.update(organisations).set({ status: "suspended" }).where(eq(organisations.id, firstId))
      expect((await signup(signupPayload(siret))).statusCode).toBe(409)

      await db.update(organisations).set({ status: "rejected" }).where(eq(organisations.id, firstId))
      expect((await signup(signupPayload(siret))).statusCode).toBe(201)
    })
  })

  describe("POST /api/organisations/request — a registered customer turns pro", () => {
    const request = (token: string, siret = newSiret()) =>
      app.inject({
        method: "POST",
        url: "/api/organisations/request",
        headers: { authorization: `Bearer ${token}` },
        payload: { siret, legalName: "Club de Tir du Val", organisationType: "club" },
      })

    it("attaches a pending organisation to the account", async () => {
      const paul = await customer()

      const res = await request(paul.token)

      expect(res.statusCode).toBe(201)
      expect(res.json().data).toMatchObject({ status: "pending", type: "club", legalName: "Club de Tir du Val" })
      expect((await organisationOf(paul.id))?.status).toBe("pending")
      expect(sendOrganisationRequestReceivedEmail).toHaveBeenCalledWith(
        paul.email,
        { legalName: "Club de Tir du Val" },
        { userId: paul.id },
      )
    })

    it("caps the sessions already open to 7 days: the next login asks for the code", async () => {
      const paul = await customer()
      const token = generateRefreshToken()
      await db.insert(refreshTokens).values({
        userId: paul.id,
        tokenHash: hashRefreshToken(token),
        expiresAt: new Date(Date.now() + 30 * DAY_MS),
        familyId: crypto.randomUUID(),
      })

      await request(paul.token)

      const [session] = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, paul.id))
      expect(session?.sessionExpiresAt?.getTime()).toBeLessThanOrEqual(Date.now() + 7 * DAY_MS)
      expect(session?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 7 * DAY_MS)
    })

    it("lets a member whose request was refused file a new one", async () => {
      const paul = await customer()
      const refused = (await request(paul.token)).json().data
      await db.update(organisations).set({ status: "rejected" }).where(eq(organisations.id, refused.id))

      const res = await request(paul.token)

      expect(res.statusCode).toBe(201)
      expect((await organisationOf(paul.id))?.id).toBe(res.json().data.id)
      await db.delete(auditLogs).where(eq(auditLogs.entityId, refused.id))
      await db.delete(organisations).where(eq(organisations.id, refused.id))
    })

    it("refuses a second organisation, an admin and an anonymous caller", async () => {
      const paul = await customer()
      await request(paul.token)
      const again = await request(paul.token)
      expect(again.statusCode).toBe(409)
      expect(again.json().error).toBe("AlreadyInOrganisation")

      expect((await request((await customer("admin")).token)).statusCode).toBe(403)
      const anonymous = await app.inject({ method: "POST", url: "/api/organisations/request", payload: {} })
      expect(anonymous.statusCode).toBe(401)
    })
  })

  describe("GET /api/organisations/mine", () => {
    it("shows the member their organisation, with the reason of a refusal", async () => {
      const paul = await customer()
      const created = await app.inject({
        method: "POST",
        url: "/api/organisations/request",
        headers: { authorization: `Bearer ${paul.token}` },
        payload: { siret: newSiret(), legalName: "Sécurité Privée Sud", organisationType: "securite_privee" },
      })
      await db
        .update(organisations)
        .set({ status: "rejected", reviewReason: "Autorisation CNAPS manquante" })
        .where(eq(organisations.id, created.json().data.id))

      const res = await app.inject({
        method: "GET",
        url: "/api/organisations/mine",
        headers: { authorization: `Bearer ${paul.token}` },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().data).toMatchObject({
        legalName: "Sécurité Privée Sud",
        type: "securite_privee",
        status: "rejected",
        reviewReason: "Autorisation CNAPS manquante",
      })
      expect(res.json().data.registrySnapshot).toBeUndefined()
    })

    it("answers 404 to a customer outside any organisation", async () => {
      const paul = await customer()
      const res = await app.inject({
        method: "GET",
        url: "/api/organisations/mine",
        headers: { authorization: `Bearer ${paul.token}` },
      })
      expect(res.statusCode).toBe(404)
    })
  })
})
