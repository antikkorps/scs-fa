import { EMPTY_SHOP_IDENTITY, type ShopIdentity } from "@armurier/shared"
import { eq } from "drizzle-orm"
import { db } from "../db/client.js"
import { shopIdentity } from "../db/schema.js"

type Executor = Pick<typeof db, "select" | "insert">

/**
 * The shop's identity in force (audit 2026-11-01, I8). The migration seeds the
 * single row; a database that lost it reads as nothing supplied yet.
 */
export async function loadShopIdentity(executor: Executor = db): Promise<ShopIdentity> {
  const [row] = await executor.select().from(shopIdentity).where(eq(shopIdentity.id, 1)).limit(1)
  if (!row) return EMPTY_SHOP_IDENTITY
  const { id: _id, updatedAt: _updatedAt, ...identity } = row
  return identity
}

/** Replace the record whole. */
export async function saveShopIdentity(identity: ShopIdentity, executor: Executor = db): Promise<void> {
  const values = { ...identity, updatedAt: new Date() }
  await executor
    .insert(shopIdentity)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: shopIdentity.id, set: values })
}
