import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomUUID } from "node:crypto"
import type { AuthTokens } from "@armurier/shared"
import { and, eq, gt, isNull } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import type { DbExecutor } from "../artworks/reservation.js"
import { db } from "../db/client.js"
import { refreshTokens } from "../db/schema.js"
import { env } from "../env.js"

export const REFRESH_TOKEN_BYTES = 32
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60

const REFRESH_TTL_DAYS = parseRefreshTtlDays(env.JWT_REFRESH_EXPIRES_IN)

function parseRefreshTtlDays(value: string): number {
  const match = value.match(/^(\d+)d$/)
  if (!match) throw new Error(`JWT_REFRESH_EXPIRES_IN must be in '<n>d' format, got: ${value}`)
  return Number.parseInt(match[1], 10)
}

export function generateRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString("base64url")
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function computeRefreshExpiry(now = new Date()): Date {
  return new Date(now.getTime() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000)
}

/** Story 12.8a — how long a capped session may last after its login, refreshes or not. */
export const CAPPED_SESSION_DAYS = 7

export interface SessionOwner {
  id: string
  role: string
  organisationId: string | null
}

/**
 * The absolute end of a session opened now, or null when only the sliding
 * expiry applies. Admins (decision 2026-10-19) and the members of an
 * organisation (story 12.8b) are capped.
 */
export function sessionExpiryFor(user: SessionOwner, now = new Date()): Date | null {
  if (user.role !== "admin" && user.organisationId === null) return null
  return new Date(now.getTime() + CAPPED_SESSION_DAYS * 24 * 60 * 60 * 1000)
}

export async function signAccessToken(
  fastify: FastifyInstance,
  payload: { sub: string; role: string },
): Promise<string> {
  return fastify.jwt.sign(payload)
}

// Rotations of one session reuse the parent's family and its absolute end;
// a fresh login omits both: a new family, and the cap its role calls for.
type SessionLineage = { familyId: string; sessionExpiresAt: Date | null }

async function storeRefreshToken(
  executor: DbExecutor,
  refreshToken: string,
  user: SessionOwner,
  deviceLabel: string | null,
  session?: SessionLineage,
): Promise<void> {
  const sessionExpiresAt = session ? session.sessionExpiresAt : sessionExpiryFor(user)
  const slidingExpiry = computeRefreshExpiry()
  await executor.insert(refreshTokens).values({
    userId: user.id,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: sessionExpiresAt && sessionExpiresAt < slidingExpiry ? sessionExpiresAt : slidingExpiry,
    deviceLabel,
    familyId: session?.familyId ?? randomUUID(),
    sessionExpiresAt,
  })
}

/** The access token that goes with a refresh token, ready to hand out. */
export async function tokensFor(
  fastify: FastifyInstance,
  user: SessionOwner,
  refreshToken: string,
): Promise<AuthTokens> {
  const accessToken = await signAccessToken(fastify, { sub: user.id, role: user.role })
  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS }
}

export async function issueTokens(
  fastify: FastifyInstance,
  user: SessionOwner,
  deviceLabel: string | null,
  session?: SessionLineage,
): Promise<AuthTokens> {
  const refreshToken = generateRefreshToken()
  await storeRefreshToken(db, refreshToken, user, deviceLabel, session)
  return tokensFor(fastify, user, refreshToken)
}

// ── Rotation (story 12.9f) ──────────────────────────────────────────────────
// A page that loads several things at once, its access token just expired,
// sends several refreshes with the same token. The first rotates it; the others,
// within the grace, get that same successor back — one session, not a fork. A
// replay past the grace is still theft (refresh.ts).

export const ROTATION_GRACE_MS = 10 * 1000

const SEAL_IV_BYTES = 12

// The successor is sealed with a key only the holder of the rotated token can
// derive: the database alone never yields a live token.
function sealKey(rotatedToken: string): Buffer {
  return Buffer.from(hkdfSync("sha256", rotatedToken, "", "scs-firearms refresh successor", 32))
}

function sealSuccessor(rotatedToken: string, successor: string): string {
  const iv = randomBytes(SEAL_IV_BYTES)
  const cipher = createCipheriv("aes-256-gcm", sealKey(rotatedToken), iv)
  const sealed = Buffer.concat([cipher.update(successor, "utf8"), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString("base64url")
}

function unsealSuccessor(rotatedToken: string, sealed: string): string | null {
  const bytes = Buffer.from(sealed, "base64url")
  try {
    const decipher = createDecipheriv("aes-256-gcm", sealKey(rotatedToken), bytes.subarray(0, SEAL_IV_BYTES))
    decipher.setAuthTag(bytes.subarray(SEAL_IV_BYTES, SEAL_IV_BYTES + 16))
    return Buffer.concat([decipher.update(bytes.subarray(SEAL_IV_BYTES + 16)), decipher.final()]).toString("utf8")
  } catch {
    return null
  }
}

type RotatableToken = typeof refreshTokens.$inferSelect

/**
 * Rotate `presented` into a new refresh token, or null when a concurrent
 * refresh already did. The claim and the successor commit together: a racing
 * refresh waits on the row, then finds both.
 */
export async function rotateRefreshToken(
  stored: RotatableToken,
  presented: string,
  user: SessionOwner,
): Promise<string | null> {
  const successor = generateRefreshToken()
  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date(), successorSealed: sealSuccessor(presented, successor) })
      .where(and(eq(refreshTokens.id, stored.id), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id })
    if (!claimed) return null
    await storeRefreshToken(tx, successor, user, stored.deviceLabel, {
      familyId: stored.familyId,
      sessionExpiresAt: stored.sessionExpiresAt,
    })
    return successor
  })
}

/** The successor of a token rotated within the grace, if it is still live; null otherwise. */
export async function successorWithinGrace(stored: RotatableToken, presented: string): Promise<string | null> {
  if (!stored.revokedAt || !stored.successorSealed) return null
  if (Date.now() - stored.revokedAt.getTime() > ROTATION_GRACE_MS) return null
  const successor = unsealSuccessor(presented, stored.successorSealed)
  if (!successor) return null
  const [live] = await db
    .select({ id: refreshTokens.id })
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.tokenHash, hashRefreshToken(successor)),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, new Date()),
      ),
    )
    .limit(1)
  return live ? successor : null
}

// Look up a refresh token by hash regardless of state — the refresh route needs
// to see revoked/expired rows to detect reuse (a replayed, already-rotated token
// is a theft signal).
export async function findRefreshTokenByHash(token: string) {
  const [row] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hashRefreshToken(token)))
    .limit(1)
  return row ?? null
}

// Revoke every still-active token in a family — used when a consumed token is
// replayed (breach): the whole session tree is invalidated at once.
export async function revokeRefreshFamily(familyId: string): Promise<number> {
  const rows = await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)))
    .returning({ id: refreshTokens.id })
  return rows.length
}

export async function revokeRefreshTokenByValue(token: string): Promise<boolean> {
  const tokenHash = hashRefreshToken(token)
  const deleted = await db
    .delete(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .returning({ id: refreshTokens.id })
  return deleted.length > 0
}
