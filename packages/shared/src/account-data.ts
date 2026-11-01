// Story 12.11 — a customer's rights over their own data, in self-service: an
// export of everything the account holds, and the deletion of the account.
import { z } from "zod"
import { appCodeSchema } from "./validation.js"

/** The password again — and the app's code when the account has one — before data leaves or goes. */
export const accountReauthSchema = z
  .object({ password: z.string().min(1).max(200), code: appCodeSchema.optional() })
  .strict()

export type AccountReauthInput = z.infer<typeof accountReauthSchema>

/**
 * Why a deletion is refused. An admin or an organisation's account is closed by
 * SCS, not by its holder; an order or a quote still running must end first.
 */
export const ACCOUNT_DELETION_BLOCKERS = [
  "AdminAccount",
  "OrganisationAccount",
  "OrderInProgress",
  "QuoteInProgress",
] as const

export type AccountDeletionBlocker = (typeof ACCOUNT_DELETION_BLOCKERS)[number]

/** The export's file name, dated (UTC) so successive exports stay apart. */
export function accountExportFilename(at: Date): string {
  return `scs-firearms-mes-donnees-${at.toISOString().slice(0, 10)}.json`
}
