// Decision Franck 2026-11-04 — admins are invited, never handed a password:
// a provisional one would have to travel (and sit in the server's .env), and
// whoever intercepted it first would set the password and enrol their own phone.
//
// The account is created without a usable password (the hash of random bytes
// nobody holds) and the invited person gets a single-use link to choose theirs —
// the password-reset mechanism, with a longer life. Their first login then
// enrols the authenticator app, mandatory for admins (story 12.8e).
import { randomBytes } from "node:crypto"
import { type AdminInvitationInput, adminInvitationSchema, CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { and, eq, isNull } from "drizzle-orm"
import { recordAuditEvent } from "../audit/record.js"
import { db } from "../db/client.js"
import { passwordResetTokens, users } from "../db/schema.js"
import { sendAdminInvitationEmail } from "../email.js"
import { env } from "../env.js"
import { hashPassword } from "./password.js"
import { generateRefreshToken, hashRefreshToken } from "./tokens.js"

export const ADMIN_INVITATION_TTL_HOURS = 72
const HOUR_MS = 60 * 60 * 1000

/** Who sends the invitation: an admin from the back-office, or nobody (the server command). */
export interface Inviter {
  id: string
  ipAddress?: string | null
  userAgent?: string | null
}

export interface AdminInvitation {
  email: string
  /** False when the e-mail is an admin already: a new link replaces theirs. */
  created: boolean
  /** Also shown by the server command, to pass on another way if the e-mail fails. */
  link: string
  emailSent: boolean
}

export class NotAnAdminError extends Error {
  constructor(email: string) {
    super(`${email} has an account that is not an admin: an invitation never changes a role`)
    this.name = "NotAnAdminError"
  }
}

/** Create the admin (or find them) and give them a fresh single-use link; earlier unused links stop working. */
export async function inviteAdmin(
  input: AdminInvitationInput,
  now: Date = new Date(),
  inviter: Inviter | null = null,
): Promise<AdminInvitation> {
  const { email, firstname, lastname } = adminInvitationSchema.parse(input)
  const token = generateRefreshToken()
  // Hashed before the transaction: argon2 is slow and needs no lock.
  const unusablePasswordHash = await hashPassword(randomBytes(32).toString("base64url"))

  const { userId, created } = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)
    if (existing && existing.role !== "admin") throw new NotAnAdminError(email)

    let id = existing?.id
    if (!id) {
      const [inserted] = await tx
        .insert(users)
        .values({
          email,
          passwordHash: unusablePasswordHash,
          role: "admin",
          firstname,
          lastname,
          rgpdConsentAt: now,
          rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
        })
        .returning({ id: users.id })
      id = inserted?.id
    }
    if (!id) throw new Error("The admin account could not be created")

    // One live link at a time: a new invitation replaces the previous one.
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(and(eq(passwordResetTokens.userId, id), isNull(passwordResetTokens.usedAt)))
    await tx.insert(passwordResetTokens).values({
      userId: id,
      tokenHash: hashRefreshToken(token),
      expiresAt: new Date(now.getTime() + ADMIN_INVITATION_TTL_HOURS * HOUR_MS),
    })
    await recordAuditEvent(
      {
        userId: inviter?.id ?? null,
        userRole: inviter ? "admin" : "system",
        entityType: "user",
        entityId: id,
        action: "user.admin_invited",
        newValue: { renewed: Boolean(existing) },
        ipAddress: inviter?.ipAddress ?? null,
        userAgent: inviter?.userAgent ?? null,
      },
      tx,
    )
    return { userId: id, created: !existing }
  })

  // In the fragment, which no server, proxy or audience measurement sees (story 12.9g).
  const link = `${env.WEB_BASE_URL}/reset-password#token=${token}`
  const emailSent = await sendAdminInvitationEmail(email, link, ADMIN_INVITATION_TTL_HOURS, { userId })
    .then(() => true)
    .catch(() => false)

  return { email, created, link, emailSent }
}
