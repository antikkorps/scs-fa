// Decision 2026-11-04: a live site's admins are invited, never created with a
// password from the .env (it would have to travel, and sit on the server). The
// seed says how many there are, so a redeploy never reads as « no admin ».

import { and, count, eq, isNull } from "drizzle-orm"
import { db } from "./client.js"
import { users } from "./schema.js"

export function productionAdminNotice(admins: number): string {
  if (admins === 0) return "⚠️  No admin yet: invite one with `just admin-invite <email> <prénom> <nom>`"
  const noun = admins === 1 ? "admin" : "admins"
  return `✅ ${admins} ${noun} in place; the seed creates none in production (invitations only)`
}

/** The live admin accounts, as the back-office's team screen lists them. */
export async function countAdmins(): Promise<number> {
  const [row] = await db
    .select({ admins: count() })
    .from(users)
    .where(and(eq(users.role, "admin"), isNull(users.deletedAt)))
  return row?.admins ?? 0
}
