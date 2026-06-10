import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { and, eq, inArray, like } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { db } from "../db/client.js"
import { auditLogs, legalDocuments, users } from "../db/schema.js"
import { sendLegalDocSlaBreachEmail } from "../email.js"
import { runLegalDocSlaBreachCheck } from "./sla.js"

vi.mock("../email.js", () => ({
  sendLegalDocSlaBreachEmail: vi.fn().mockResolvedValue(undefined),
}))

const mockSend = vi.mocked(sendLegalDocSlaBreachEmail)

const PASSWORD = "MotDePasseTresLong123!"
const PREFIX = "slacron-test"
const HOUR_MS = 60 * 60 * 1000

describe("legal doc SLA breach check (runLegalDocSlaBreachCheck)", () => {
  let passwordHash: string

  async function cleanup() {
    const myUsers = db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `${PREFIX}%`))
    const myDocs = db
      .select({ id: legalDocuments.id })
      .from(legalDocuments)
      .where(inArray(legalDocuments.userId, myUsers))
    // Audit rows for the system actor have userId NULL, so scope them by document
    await db.delete(auditLogs).where(inArray(auditLogs.entityId, myDocs))
    await db.delete(legalDocuments).where(inArray(legalDocuments.userId, myUsers))
    await db.delete(users).where(like(users.email, `${PREFIX}%`))
  }

  async function makeUser(suffix: string, role: "customer" | "admin") {
    const [u] = await db
      .insert(users)
      .values({
        email: `${PREFIX}-${suffix}@${PREFIX}.local`,
        passwordHash,
        role,
        firstname: "Test",
        lastname: role === "admin" ? "Admin" : "Customer",
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id })
    return u.id
  }

  async function seedDoc(overrides: Partial<typeof legalDocuments.$inferInsert> & { userId: string }) {
    const [row] = await db
      .insert(legalDocuments)
      .values({
        docType: "cni",
        s3Key: `legal-documents/${overrides.userId}/test.pdf`,
        s3Url: `memory://legal-documents/${overrides.userId}/test.pdf`,
        mimeType: "application/pdf",
        fileSize: 100,
        scanStatus: "clean",
        verificationStatus: "pending",
        ...overrides,
      } as typeof legalDocuments.$inferInsert)
      .returning()
    return row
  }

  function reload(id: string) {
    return db
      .select({ slaBreachNotifiedAt: legalDocuments.slaBreachNotifiedAt })
      .from(legalDocuments)
      .where(eq(legalDocuments.id, id))
      .limit(1)
      .then((r) => r[0])
  }

  beforeEach(async () => {
    if (!passwordHash) passwordHash = await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
    mockSend.mockClear()
    await cleanup()
  })

  afterAll(cleanup)

  it("alerts admins on a pending document past its SLA deadline, then marks and audits it", async () => {
    const adminId = await makeUser("admin", "admin")
    const customerId = await makeUser("customer", "customer")
    const now = new Date()
    const deadline = new Date(now.getTime() - 5 * HOUR_MS)
    const doc = await seedDoc({ userId: customerId, docType: "cni", verificationDeadline: deadline })

    const res = await runLegalDocSlaBreachCheck(now)

    expect(res.notified).toBe(true)
    expect(res.breached).toBeGreaterThanOrEqual(1)

    // One digest email to the admin, covering this breach
    expect(mockSend).toHaveBeenCalledTimes(1)
    const [recipients, items] = mockSend.mock.calls[0]
    const [admin] = await db.select({ email: users.email }).from(users).where(eq(users.id, adminId))
    expect(recipients).toContain(admin.email)
    const mine = items.find((i) => i.docType === "cni")
    expect(mine).toBeDefined()
    expect(mine?.hoursOverdue).toBe(5)

    // Document is stamped so the next run won't re-alert
    expect((await reload(doc.id)).slaBreachNotifiedAt).not.toBeNull()

    // System audit trail entry
    const audit = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, doc.id), eq(auditLogs.action, "legal_doc_sla_breached")))
    expect(audit).toHaveLength(1)
    expect(audit[0].userId).toBeNull()
    expect(audit[0].userRole).toBe("system")
    expect((audit[0].newValue as { hoursOverdue: number }).hoursOverdue).toBe(5)
  })

  it("does not re-alert a document that was already notified", async () => {
    await makeUser("admin", "admin")
    const customerId = await makeUser("customer", "customer")
    const now = new Date()
    await seedDoc({
      userId: customerId,
      verificationDeadline: new Date(now.getTime() - 5 * HOUR_MS),
      slaBreachNotifiedAt: new Date(now.getTime() - 2 * HOUR_MS),
    })

    const res = await runLegalDocSlaBreachCheck(now)

    expect(res.breached).toBe(0)
    expect(res.notified).toBe(false)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("ignores documents whose deadline is still in the future", async () => {
    await makeUser("admin", "admin")
    const customerId = await makeUser("customer", "customer")
    const now = new Date()
    const doc = await seedDoc({ userId: customerId, verificationDeadline: new Date(now.getTime() + 5 * HOUR_MS) })

    const res = await runLegalDocSlaBreachCheck(now)

    expect(res.breached).toBe(0)
    expect(mockSend).not.toHaveBeenCalled()
    expect((await reload(doc.id)).slaBreachNotifiedAt).toBeNull()
  })

  it("ignores documents that are no longer pending even if past deadline", async () => {
    await makeUser("admin", "admin")
    const customerId = await makeUser("customer", "customer")
    const now = new Date()
    const past = new Date(now.getTime() - 5 * HOUR_MS)
    await seedDoc({ userId: customerId, docType: "cni", verificationStatus: "approved", verificationDeadline: past })
    await seedDoc({
      userId: customerId,
      docType: "permis_chasse",
      verificationStatus: "rejected",
      verificationDeadline: past,
    })

    const res = await runLegalDocSlaBreachCheck(now)

    expect(res.breached).toBe(0)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("ignores documents without a deadline", async () => {
    await makeUser("admin", "admin")
    const customerId = await makeUser("customer", "customer")
    await seedDoc({ userId: customerId, verificationDeadline: null })

    const res = await runLegalDocSlaBreachCheck(new Date())

    expect(res.breached).toBe(0)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("sends a single digest to every admin, covering all breaches", async () => {
    await makeUser("admin1", "admin")
    await makeUser("admin2", "admin")
    const customerId = await makeUser("customer", "customer")
    const now = new Date()
    const past = new Date(now.getTime() - 5 * HOUR_MS)
    await seedDoc({ userId: customerId, docType: "cni", verificationDeadline: past })
    await seedDoc({ userId: customerId, docType: "permis_chasse", verificationDeadline: past })

    const res = await runLegalDocSlaBreachCheck(now)

    expect(res.notified).toBe(true)
    expect(res.breached).toBe(2)
    expect(mockSend).toHaveBeenCalledTimes(1)
    const [recipients, items] = mockSend.mock.calls[0]
    expect(recipients).toHaveLength(2)
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.docType).sort()).toEqual(["cni", "permis_chasse"])
  })

  it("leaves breaches unmarked when there is no admin to notify", async () => {
    const customerId = await makeUser("customer", "customer")
    const now = new Date()
    const doc = await seedDoc({ userId: customerId, verificationDeadline: new Date(now.getTime() - 5 * HOUR_MS) })

    const res = await runLegalDocSlaBreachCheck(now)

    expect(res.breached).toBeGreaterThanOrEqual(1)
    expect(res.notified).toBe(false)
    expect(mockSend).not.toHaveBeenCalled()
    // Not marked: a later run retries once an admin exists
    expect((await reload(doc.id)).slaBreachNotifiedAt).toBeNull()
  })
})
