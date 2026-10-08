import { spawnSync } from "node:child_process"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { migrateDatabase, TEST_DATABASE_URL, withDatabaseName } from "../test/database.js"

// The seed as a deployment runs it: a fresh database, the migrations, then the
// CLI in its own process. The suite's database cannot answer this — it is
// seeded with the demo catalogue on purpose.
const SEED_DATABASE = "armurier_seed_check"
const seedDatabaseUrl = withDatabaseName(TEST_DATABASE_URL, SEED_DATABASE)

async function onServer(statement: string): Promise<void> {
  const client = new pg.Client({ connectionString: withDatabaseName(TEST_DATABASE_URL, "postgres") })
  await client.connect()
  try {
    await client.query(statement)
  } finally {
    await client.end()
  }
}

async function countRows(table: string, where = "true"): Promise<number> {
  const client = new pg.Client({ connectionString: seedDatabaseUrl })
  await client.connect()
  try {
    const result = await client.query(`select count(*)::int as total from ${table} where ${where}`)
    return result.rows[0].total
  } finally {
    await client.end()
  }
}

function runSeed(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync("pnpm", ["exec", "tsx", "src/db/seed-cli.ts", ...args], {
    env: { ...process.env, DATABASE_URL: seedDatabaseUrl, NODE_ENV: "test", STORAGE_DRIVER: "memory", ...env },
    encoding: "utf8",
  })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

describe("seed CLI (deployment)", () => {
  beforeAll(async () => {
    await onServer(`DROP DATABASE IF EXISTS ${SEED_DATABASE} WITH (FORCE)`)
    await onServer(`CREATE DATABASE ${SEED_DATABASE}`)
    migrateDatabase(seedDatabaseUrl)
  }, 120_000)

  afterAll(async () => {
    await onServer(`DROP DATABASE IF EXISTS ${SEED_DATABASE} WITH (FORCE)`)
  })

  // A missing password falls back to the same sample, so this covers both.
  it("refuses to create the production admin with the sample password of .env.example", () => {
    const { status, output } = runSeed([], { NODE_ENV: "production", ADMIN_SEED_PASSWORD: "AdminSCS-ChangeMe-2026!" })
    expect(status).not.toBe(0)
    expect(output).toMatch(/ADMIN_SEED_PASSWORD/)
  }, 60_000)

  it("lays the reference data a live site needs, and no demo content", async () => {
    const { status, output } = runSeed([])
    expect(status, output).toBe(0)

    expect(await countRows("legal_categories")).toBe(5)
    expect(await countRows("product_categories")).toBe(8)
    expect(await countRows("tags")).toBe(3)
    expect(await countRows("suppliers")).toBe(6)
    expect(await countRows("users", "role = 'admin'")).toBe(1)

    expect(await countRows("products")).toBe(0)
    expect(await countRows("artworks")).toBe(0)
    expect(await countRows("artists")).toBe(0)
    expect(await countRows("blog_posts")).toBe(0)
  }, 60_000)

  it("adds the demo catalogue only when asked, and replays without duplicating", async () => {
    expect(runSeed(["--demo"]).status).toBe(0)
    const products = await countRows("products")
    expect(products).toBeGreaterThan(0)
    expect(await countRows("artworks")).toBeGreaterThan(0)
    expect(await countRows("blog_posts")).toBeGreaterThan(0)

    expect(runSeed(["--demo"]).status).toBe(0)
    expect(await countRows("products")).toBe(products)
    expect(await countRows("suppliers")).toBe(6)
  }, 120_000)
})
