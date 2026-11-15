// Audit 2026-11-15 (M1) — an account's address counts as its owner's only once
// they proved they read that mailbox: the mailed login code, a password-reset
// link or an admin invite link. Until then a login asks for the code
// (login-code-policy.ts) and nothing is matched to the account by address
// (RGPD export and erasure).

import { and, eq, isNull } from "drizzle-orm"
import type { DbExecutor } from "../artworks/reservation.js"
import { db } from "../db/client.js"
import { users } from "../db/schema.js"

/**
 * Record the proof, once: the first date stays. True when this call confirmed
 * the address, so the caller journals the event only then.
 */
export async function markEmailVerified(userId: string, executor: DbExecutor = db): Promise<boolean> {
  const confirmed = await executor
    .update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)))
    .returning({ id: users.id })
  return confirmed.length > 0
}
