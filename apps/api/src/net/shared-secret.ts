import { timingSafeEqual } from "node:crypto"

/** Whether `sent` is the shared secret, compared in constant time. No secret configured = no match. */
export function matchesSecret(sent: unknown, secret: string | undefined): boolean {
  if (!secret || typeof sent !== "string") return false
  const a = Buffer.from(sent)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}
