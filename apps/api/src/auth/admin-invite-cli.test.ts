import { spawnSync } from "node:child_process"
import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { eq, inArray, like } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db } from "../db/client.js"
import { auditLogs, passwordResetTokens, users } from "../db/schema.js"

// `pnpm auth:admin-invite <email> <prénom> <nom>`, run in its own process as on the server.
const EMAIL_SUFFIX = "@admin-invite-cli.local"

function runInvite(args: string[]) {
  const result = spawnSync("pnpm", ["exec", "tsx", "src/auth/admin-invite-cli.ts", ...args], {
    env: { ...process.env, NODE_ENV: "test", STORAGE_DRIVER: "memory" },
    encoding: "utf8",
  })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

async function cleanup() {
  const ids = db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `%${EMAIL_SUFFIX}`))
  await db.delete(auditLogs).where(inArray(auditLogs.entityId, ids))
  await db.delete(passwordResetTokens).where(inArray(passwordResetTokens.userId, ids))
  await db.delete(users).where(like(users.email, `%${EMAIL_SUFFIX}`))
}

describe("admin invitation command", () => {
  beforeAll(cleanup)
  afterAll(cleanup)

  it("invites the admin and prints the link, with a last name of several words", async () => {
    const { status, output } = runInvite([`fred${EMAIL_SUFFIX}`, "Fred", "de", "La", "Tour"])

    expect(status, output).toBe(0)
    expect(output).toMatch(/\/reset-password#token=/)
    expect(output).toContain("72 h")
    const [admin] = await db
      .select()
      .from(users)
      .where(eq(users.email, `fred${EMAIL_SUFFIX}`))
    expect(admin).toMatchObject({ role: "admin", firstname: "Fred", lastname: "de La Tour" })
  }, 60_000)

  it("explains how to call it when an argument is missing", () => {
    const { status, output } = runInvite([`fred${EMAIL_SUFFIX}`])
    expect(status).not.toBe(0)
    expect(output).toContain("Usage")
  }, 60_000)

  it("refuses to make an existing customer an admin", async () => {
    const email = `client${EMAIL_SUFFIX}`
    await db.insert(users).values({
      email,
      passwordHash: "not-used",
      role: "customer",
      rgpdConsentAt: new Date(),
      rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
    })

    const { status, output } = runInvite([email, "Jean", "Client"])

    expect(status).not.toBe(0)
    expect(output).toContain("pas un compte administrateur")
  }, 60_000)
})
