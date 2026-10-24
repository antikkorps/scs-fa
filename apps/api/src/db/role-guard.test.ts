import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { pool } from "./client.js"
import { databaseRoleProblems } from "./role-guard.js"

// The suite connects as the superuser; `SET ROLE` borrows a role's privileges
// inside one transaction, so each case runs as the role under test.
const APP_LIKE = "test_role_guard_app"
const OWNER_LIKE = "test_role_guard_owner"

/** DROP OWNED also revokes the role's grants, which would otherwise block DROP ROLE. */
async function dropTestRoles(): Promise<void> {
  for (const role of [APP_LIKE, OWNER_LIKE]) {
    const { rowCount } = await pool.query("SELECT FROM pg_roles WHERE rolname = $1", [role])
    if (!rowCount) continue
    await pool.query(`DROP OWNED BY ${role}`)
    await pool.query(`DROP ROLE ${role}`)
  }
}

async function problemsAs(role: string | null): Promise<string[]> {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    if (role) await client.query(`SET LOCAL ROLE ${role}`)
    return await databaseRoleProblems(client)
  } finally {
    await client.query("ROLLBACK")
    client.release()
  }
}

describe("databaseRoleProblems (story 12.9f)", () => {
  beforeAll(async () => {
    await dropTestRoles()
    await pool.query(`CREATE ROLE ${APP_LIKE} NOLOGIN`)
    await pool.query(`CREATE ROLE ${OWNER_LIKE} NOLOGIN`)
    await pool.query(`GRANT USAGE ON SCHEMA public TO ${APP_LIKE}, ${OWNER_LIKE}`)
    await pool.query(`CREATE TABLE test_role_guard_owned (id int)`)
    await pool.query(`ALTER TABLE test_role_guard_owned OWNER TO ${OWNER_LIKE}`)
  })

  afterAll(async () => {
    // The owned table goes with DROP OWNED.
    await dropTestRoles()
  })

  it("accepts a role that only reads and writes rows", async () => {
    expect(await problemsAs(APP_LIKE)).toEqual([])
  })

  it("refuses the superuser", async () => {
    expect(await problemsAs(null)).toContain("the role is a superuser")
  })

  it("refuses a role that owns tables, hence may alter or drop them", async () => {
    expect(await problemsAs(OWNER_LIKE)).toContain("the role owns tables")
  })

  it("refuses a role that may create objects in the public schema", async () => {
    await pool.query(`GRANT CREATE ON SCHEMA public TO ${APP_LIKE}`)
    try {
      expect(await problemsAs(APP_LIKE)).toContain("the role may create objects in the public schema")
    } finally {
      await pool.query(`REVOKE CREATE ON SCHEMA public FROM ${APP_LIKE}`)
    }
  })
})
