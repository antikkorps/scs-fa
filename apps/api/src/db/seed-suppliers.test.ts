import { CATALOG_SUPPLIERS } from "@armurier/shared"
import { sql } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import { db } from "./client.js"
import { suppliers } from "./schema.js"
import { seedSuppliers } from "./seed-suppliers.js"

async function countByName(name: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(suppliers)
    .where(sql`lower(${suppliers.name}) = lower(${name})`)
  return row?.total ?? 0
}

describe("seedSuppliers (story 12.5)", () => {
  it("declares every collected supplier, so their triage files import on a fresh deployment", async () => {
    await seedSuppliers()
    for (const name of Object.values(CATALOG_SUPPLIERS)) expect(await countByName(name)).toBe(1)
  })

  it("can run again on a live database without duplicating or renaming anything", async () => {
    await seedSuppliers()
    await seedSuppliers()
    for (const name of Object.values(CATALOG_SUPPLIERS)) expect(await countByName(name)).toBe(1)
  })
})
