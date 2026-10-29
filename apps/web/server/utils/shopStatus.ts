import type { LaunchStage } from "@armurier/shared"

/** Shape of `GET /api/shop-status` (story 12.10). */
export interface ShopStatus {
  launchStage: LaunchStage
  indexingEnabled: boolean
}

// What the site assumes when the API has never answered: closed and out of the
// indexes. Failing open would show an unfinished shop, or index it, on a blip.
export const CLOSED_SHOP_STATUS: ShopStatus = { launchStage: "coming_soon", indexingEnabled: false }

interface LoaderOptions {
  ttlMs: number
  now?: () => number
}

/**
 * Every request needs the shop status (waiting page, noindex), but it changes
 * only when an administrator flips it: keep it for `ttlMs`, share one call
 * between concurrent requests, and ride out an outage on the last known value.
 */
export function createShopStatusLoader(
  fetchStatus: () => Promise<ShopStatus>,
  { ttlMs, now = Date.now }: LoaderOptions,
): () => Promise<ShopStatus> {
  let known: ShopStatus | null = null
  let fetchedAt = Number.NEGATIVE_INFINITY
  let pending: Promise<ShopStatus> | null = null

  function refresh(): Promise<ShopStatus> {
    pending ??= fetchStatus()
      .then((status) => {
        known = status
        fetchedAt = now()
        return status
      })
      .catch(() => known ?? CLOSED_SHOP_STATUS)
      .finally(() => {
        pending = null
      })
    return pending
  }

  return async () => (known && now() - fetchedAt < ttlMs ? known : refresh())
}
