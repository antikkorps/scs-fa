// Story 12.8e — the app-based second factor of an account: enrolment (a secret
// shown as a QR code, confirmed by a first code), verification by the app's
// code or by a single-use recovery code, regeneration of those codes, reset.
// The secret is kept encrypted (TOTP_ENCRYPTION_KEY), the recovery codes hashed.

import { createHmac, hkdfSync, randomInt } from "node:crypto"
import { and, eq, isNull, lt, or } from "drizzle-orm"
import { renderSVG } from "uqr"
import type { DbExecutor } from "../artworks/reservation.js"
import { db } from "../db/client.js"
import { recoveryCodes, users } from "../db/schema.js"
import { env } from "../env.js"
import { base32Encode, decryptSecret, encryptSecret, generateTotpSecret, otpauthUri, verifyTotp } from "./totp.js"

export const RECOVERY_CODE_COUNT = 10
// No 0/O, 1/I/L: a code copied by hand from paper must not be ambiguous.
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
const RECOVERY_HALF = 5

const RECOVERY_KEY = Buffer.from(hkdfSync("sha256", env.TOTP_ENCRYPTION_KEY, "", "scs-firearms recovery code", 32))

function newRecoveryCode(): string {
  const half = () =>
    Array.from({ length: RECOVERY_HALF }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join("")
  return `${half()}-${half()}`
}

function normaliseRecoveryCode(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase()
}

function digestRecoveryCode(code: string): string {
  return createHmac("sha256", RECOVERY_KEY).update(normaliseRecoveryCode(code)).digest("hex")
}

export interface Enrolment {
  /** Base32, to type in by hand when the QR code cannot be scanned. */
  secret: string
  otpauthUri: string
  qrSvg: string
}

/** A new secret, kept aside (encrypted) until a first code confirms the app holds it. */
export async function beginEnrollment(
  user: { id: string; email: string },
  executor: DbExecutor = db,
): Promise<Enrolment> {
  const secret = generateTotpSecret()
  await executor
    .update(users)
    .set({ totpPendingSecretEncrypted: encryptSecret(secret, env.TOTP_ENCRYPTION_KEY), updatedAt: new Date() })
    .where(eq(users.id, user.id))
  const uri = otpauthUri(secret, user.email)
  return { secret: base32Encode(secret), otpauthUri: uri, qrSvg: renderSVG(uri) }
}

/** Fresh recovery codes, the previous ones voided; returned in clear this once. */
export async function regenerateRecoveryCodes(userId: string, executor: DbExecutor = db): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode)
  await executor.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId))
  await executor.insert(recoveryCodes).values(codes.map((code) => ({ userId, codeHash: digestRecoveryCode(code) })))
  return codes
}

/**
 * The first code proves the app holds the pending secret: the app is enabled
 * and the recovery codes handed out. Null when the code is wrong (or nothing
 * is pending).
 */
export async function confirmEnrollment(userId: string, code: string, now: Date): Promise<string[] | null> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ pending: users.totpPendingSecretEncrypted })
      .from(users)
      .where(eq(users.id, userId))
      .for("update")
    if (!user?.pending) return null
    const step = verifyTotp(decryptSecret(user.pending, env.TOTP_ENCRYPTION_KEY), code, now, null)
    if (step === null) return null
    await tx
      .update(users)
      .set({
        totpSecretEncrypted: user.pending,
        totpPendingSecretEncrypted: null,
        totpEnabledAt: now,
        totpLastStep: step,
        updatedAt: now,
      })
      .where(eq(users.id, userId))
    return regenerateRecoveryCodes(userId, tx)
  })
}

/**
 * The app's code or a recovery code, each serving once: which one it was, or
 * null. The app's step is recorded in the same guarded update that accepts it,
 * so two requests racing with one code cannot both pass.
 */
export async function verifySecondFactor(
  userId: string,
  input: string,
  now: Date,
): Promise<"totp" | "recovery_code" | null> {
  const [user] = await db
    .select({ secret: users.totpSecretEncrypted, lastStep: users.totpLastStep })
    .from(users)
    .where(eq(users.id, userId))
  if (!user?.secret) return null

  if (/^\d{3}\s?\d{3}$/.test(input.trim())) {
    const step = verifyTotp(decryptSecret(user.secret, env.TOTP_ENCRYPTION_KEY), input, now, user.lastStep)
    if (step === null) return null
    const [taken] = await db
      .update(users)
      .set({ totpLastStep: step })
      .where(and(eq(users.id, userId), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
      .returning({ id: users.id })
    return taken ? "totp" : null
  }

  const [used] = await db
    .update(recoveryCodes)
    .set({ usedAt: now })
    .where(
      and(
        eq(recoveryCodes.userId, userId),
        eq(recoveryCodes.codeHash, digestRecoveryCode(input)),
        isNull(recoveryCodes.usedAt),
      ),
    )
    .returning({ id: recoveryCodes.id })
  return used ? "recovery_code" : null
}

/** How many recovery codes remain unused. */
export async function remainingRecoveryCodes(userId: string): Promise<number> {
  const rows = await db
    .select({ id: recoveryCodes.id })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)))
  return rows.length
}

/** The app gone (disabled, or reset after a lost phone): secret, pending enrolment and recovery codes. */
export async function resetSecondFactor(userId: string, executor: DbExecutor = db): Promise<void> {
  await executor
    .update(users)
    .set({
      totpSecretEncrypted: null,
      totpPendingSecretEncrypted: null,
      totpEnabledAt: null,
      totpLastStep: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
  await executor.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId))
}
