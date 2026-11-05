import type { z } from "zod"
import { accountReauthSchema } from "./account-data.js"
import { adminInvitationSchema } from "./validation.js"

// Request Franck 2026-11-04 — inviting a helper from the back-office asks the
// inviting admin's own password and code, like every change to the team.
export const adminInvitationRequestSchema = adminInvitationSchema.extend(accountReauthSchema.shape).strict()
export type AdminInvitationRequest = z.infer<typeof adminInvitationRequestSchema>

/** One admin as the team screen lists them; no secret leaves the API. */
export interface AdminTeamMember {
  id: string
  email: string
  firstname: string | null
  lastname: string | null
  totpEnabled: boolean
  /** The end of a live invitation link, or null when none is waiting. */
  invitationExpiresAt: string | null
  isMe: boolean
}
