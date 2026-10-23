import { eq, sql } from "drizzle-orm"
import { db } from "../db/client.js"
import { users } from "../db/schema.js"

// The account lockout, shared by the two login steps: a wrong password and a
// wrong e-mailed code count alike (story 12.9f), so knowing the password does
// not buy an endless supply of codes to try.

export const MAX_FAILED_ATTEMPTS = 5
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000
/**
 * Only failures this recent count towards the lockout. Without a window the
 * counter never decayed: typos from weeks ago plus two today locked the
 * account (seen on the dev admin, 2026-10-03).
 */
export const FAILED_ATTEMPTS_WINDOW_MS = 15 * 60 * 1000

/** The lockout still running on this account, if any, in whole seconds. */
export function lockoutRemainingSeconds(user: { lockedUntil: Date | null }): number | null {
  if (!user.lockedUntil || user.lockedUntil <= new Date()) return null
  return Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000)
}

/** Count one failed login step; the last one allowed locks the account. */
export async function countFailedLogin(userId: string): Promise<{ attempts: number; locked: boolean }> {
  // Counted in SQL, in one statement: a failure outside the window starts
  // a new count, and concurrent attempts cannot overwrite each other.
  const windowStart = new Date(Date.now() - FAILED_ATTEMPTS_WINDOW_MS)
  const [counted] = await db
    .update(users)
    .set({
      // The bound is encoded like the column itself (UTC, no zone): a raw
      // Date would carry the session's offset and skew the comparison.
      failedLoginAttempts: sql`case when ${users.lastFailedLoginAt} > ${sql.param(windowStart, users.lastFailedLoginAt)} then ${users.failedLoginAttempts} + 1 else 1 end`,
      lastFailedLoginAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning({ attempts: users.failedLoginAttempts })
  const attempts = counted?.attempts ?? 1
  const locked = attempts >= MAX_FAILED_ATTEMPTS
  if (locked) {
    await db
      .update(users)
      .set({ failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) })
      .where(eq(users.id, userId))
  }
  return { attempts, locked }
}

/** The session opens: the failure trail goes. */
export async function clearFailedLogins(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ failedLoginAttempts: 0, lockedUntil: null, lastFailedLoginAt: null, lastLoginAt: new Date() })
    .where(eq(users.id, userId))
}
