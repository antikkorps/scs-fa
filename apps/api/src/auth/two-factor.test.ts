import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { eq, like } from "drizzle-orm"
import { afterAll, describe, expect, it } from "vitest"
import { db } from "../db/client.js"
import { recoveryCodes, users } from "../db/schema.js"
import { base32Decode, totpCode } from "./totp.js"
import {
  beginEnrollment,
  confirmEnrollment,
  RECOVERY_CODE_COUNT,
  regenerateRecoveryCodes,
  resetSecondFactor,
  verifySecondFactor,
} from "./two-factor.js"

const EMAIL_SUFFIX = "@twofactor.local"
const STEP_MS = 30_000

async function account() {
  const [row] = await db
    .insert(users)
    .values({
      email: `user-${Date.now()}-${Math.random()}${EMAIL_SUFFIX}`,
      passwordHash: "$argon2id$unused",
      role: "customer",
      firstname: "Jeanne",
      lastname: "Armand",
      rgpdConsentAt: new Date(),
      rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
    })
    .returning()
  return row
}

const reload = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0]
const codeAt = (secret: string, at: Date) => totpCode(base32Decode(secret), Math.floor(at.getTime() / STEP_MS))

/** An account with the app enabled, and what it was given. */
async function enrolled() {
  const user = await account()
  const enrolment = await beginEnrollment(user)
  const now = new Date()
  const codes = await confirmEnrollment(user.id, codeAt(enrolment.secret, now), now)
  if (!codes) throw new Error("enrolment failed")
  return { user: (await reload(user.id)) as typeof user, secret: enrolment.secret, codes }
}

describe("the app-based second factor (story 12.8e)", () => {
  afterAll(async () => {
    await db.delete(users).where(like(users.email, `%${EMAIL_SUFFIX}`))
  })

  describe("enrolment", () => {
    it("draws a secret, kept encrypted until confirmed, and shows it as a QR code and a key", async () => {
      const user = await account()

      const enrolment = await beginEnrollment(user)

      expect(enrolment.secret).toMatch(/^[A-Z2-7]{32}$/)
      expect(enrolment.otpauthUri).toContain(`secret=${enrolment.secret}`)
      expect(enrolment.qrSvg).toMatch(/^<svg/)
      const stored = await reload(user.id)
      expect(stored?.totpPendingSecretEncrypted).toEqual(expect.any(String))
      expect(stored?.totpPendingSecretEncrypted).not.toContain(enrolment.secret)
      expect(stored?.totpEnabledAt).toBeNull()
    })

    it("enables the app with a first right code and hands out the recovery codes, once", async () => {
      const user = await account()
      const enrolment = await beginEnrollment(user)
      const now = new Date()

      expect(await confirmEnrollment(user.id, "000000", now)).toBeNull()
      const codes = await confirmEnrollment(user.id, codeAt(enrolment.secret, now), now)

      expect(codes).toHaveLength(RECOVERY_CODE_COUNT)
      expect(codes?.[0]).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/)
      const stored = await reload(user.id)
      expect(stored).toMatchObject({ totpPendingSecretEncrypted: null })
      expect(stored?.totpEnabledAt).toBeInstanceOf(Date)
      expect(stored?.totpSecretEncrypted).toEqual(expect.any(String))
      const kept = await db.select().from(recoveryCodes).where(eq(recoveryCodes.userId, user.id))
      expect(kept).toHaveLength(RECOVERY_CODE_COUNT)
      expect(kept.map((row) => row.codeHash)).not.toContain(codes?.[0])
    })
  })

  describe("verification", () => {
    it("accepts the app's current code once, never twice", async () => {
      const { user, secret } = await enrolled()
      const later = new Date(Date.now() + 2 * STEP_MS)
      const code = codeAt(secret, later)

      expect(await verifySecondFactor(user.id, code, later)).toBe("totp")
      expect(await verifySecondFactor(user.id, code, later)).toBeNull()
      expect(await verifySecondFactor(user.id, "123456", later)).toBeNull()
    })

    it("takes a recovery code instead, each once, in any case and with or without its dash", async () => {
      const { user, codes } = await enrolled()
      const [first, second] = codes

      expect(await verifySecondFactor(user.id, first?.toLowerCase() ?? "", new Date())).toBe("recovery_code")
      expect(await verifySecondFactor(user.id, first ?? "", new Date())).toBeNull()
      expect(await verifySecondFactor(user.id, second?.replace("-", "") ?? "", new Date())).toBe("recovery_code")
    })

    it("knows nothing of an account without the app", async () => {
      const user = await account()
      expect(await verifySecondFactor(user.id, "123456", new Date())).toBeNull()
    })
  })

  it("regenerates the recovery codes: the old ones stop working", async () => {
    const { user, codes } = await enrolled()

    const fresh = await regenerateRecoveryCodes(user.id)

    expect(fresh).toHaveLength(RECOVERY_CODE_COUNT)
    expect(await verifySecondFactor(user.id, codes[0] ?? "", new Date())).toBeNull()
    expect(await verifySecondFactor(user.id, fresh[0] ?? "", new Date())).toBe("recovery_code")
  })

  it("resets the app entirely (lost phone): secret and recovery codes gone", async () => {
    const { user, codes } = await enrolled()

    await resetSecondFactor(user.id)

    const stored = await reload(user.id)
    expect(stored).toMatchObject({ totpSecretEncrypted: null, totpEnabledAt: null, totpLastStep: null })
    expect(await db.select().from(recoveryCodes).where(eq(recoveryCodes.userId, user.id))).toHaveLength(0)
    expect(await verifySecondFactor(user.id, codes[0] ?? "", new Date())).toBeNull()
  })
})
