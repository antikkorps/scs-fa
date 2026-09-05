import { createHash, randomBytes, randomUUID } from "node:crypto"
import type { AuthTokens } from "@armurier/shared"
import { and, eq, isNull } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
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

export async function signAccessToken(
  fastify: FastifyInstance,
  payload: { sub: string; role: string },
): Promise<string> {
  return fastify.jwt.sign(payload)
}

export async function issueTokens(
  fastify: FastifyInstance,
  user: { id: string; role: string },
  deviceLabel: string | null,
  // Rotations of one session reuse the parent's family; a fresh login omits it
  // and starts a new family.
  familyId?: string,
): Promise<AuthTokens> {
  const accessToken = await signAccessToken(fastify, { sub: user.id, role: user.role })
  const refreshToken = generateRefreshToken()

  await db.insert(refreshTokens).values({
    userId: user.id,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: computeRefreshExpiry(),
    deviceLabel,
    familyId: familyId ?? randomUUID(),
  })

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  }
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

export async function markRefreshTokenRevoked(id: string): Promise<void> {
  await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, id))
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
