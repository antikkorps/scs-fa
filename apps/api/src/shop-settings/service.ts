import { DEFAULT_VIP_MARGIN_SHARE_PCT } from "@armurier/shared"
import { eq } from "drizzle-orm"
import { db } from "../db/client.js"
import { shopSettings } from "../db/schema.js"

type Executor = Pick<typeof db, "select">

export interface ShopSettings {
  /** Share of the product margin a VIP gets back, in percent (story 12.9e). */
  vipMarginSharePct: number
}

/**
 * The shop settings in force (story 12.9e). The migration seeds the single row;
 * the fallback only covers a database that lost it, at the documented default.
 */
export async function loadShopSettings(executor: Executor = db): Promise<ShopSettings> {
  const [row] = await executor.select().from(shopSettings).where(eq(shopSettings.id, 1)).limit(1)
  return { vipMarginSharePct: row ? Number(row.vipMarginSharePct) : DEFAULT_VIP_MARGIN_SHARE_PCT }
}
