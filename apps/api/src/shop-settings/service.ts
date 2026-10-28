import { DEFAULT_VIP_MARGIN_SHARE_PCT, type LaunchStage } from "@armurier/shared"
import { eq } from "drizzle-orm"
import { db } from "../db/client.js"
import { shopSettings } from "../db/schema.js"

type Executor = Pick<typeof db, "select">

export interface ShopSettings {
  /** Share of the product margin a VIP gets back, in percent (story 12.9e). */
  vipMarginSharePct: number
  /** How far the shop is open (story 12.10). */
  launchStage: LaunchStage
  /** Whether search engines may index the site (story 12.10). */
  indexingEnabled: boolean
}

/**
 * The shop settings in force (stories 12.9e, 12.10). The migration seeds the
 * single row; the fallback only covers a database that lost it, at the
 * documented defaults — closed and unindexed, like a fresh database.
 */
export async function loadShopSettings(executor: Executor = db): Promise<ShopSettings> {
  const [row] = await executor.select().from(shopSettings).where(eq(shopSettings.id, 1)).limit(1)
  if (!row)
    return { vipMarginSharePct: DEFAULT_VIP_MARGIN_SHARE_PCT, launchStage: "coming_soon", indexingEnabled: false }
  return {
    vipMarginSharePct: Number(row.vipMarginSharePct),
    launchStage: row.launchStage,
    indexingEnabled: row.indexingEnabled,
  }
}
