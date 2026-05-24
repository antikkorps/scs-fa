import { createHash, randomBytes } from "node:crypto"
import type { AuthTokens } from "@armurier/shared"
import { and, eq, gt } from "drizzle-orm"
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
): Promise<AuthTokens> {
  const accessToken = await signAccessToken(fastify, { sub: user.id, role: user.role })
  const refreshToken = generateRefreshToken()

  await db.insert(refreshTokens).values({
    userId: user.id,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: computeRefreshExpiry(),
    deviceLabel,
  })

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  }
}

export async function findValidRefreshToken(token: string) {
  const tokenHash = hashRefreshToken(token)
  const [row] = await db
    .select()
    .from(refreshTokens)
    .where(and(eq(refreshTokens.tokenHash, tokenHash), gt(refreshTokens.expiresAt, new Date())))
    .limit(1)
  return row ?? null
}

export async function revokeRefreshTokenByValue(token: string): Promise<boolean> {
  const tokenHash = hashRefreshToken(token)
  const deleted = await db
    .delete(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .returning({ id: refreshTokens.id })
  return deleted.length > 0
}
