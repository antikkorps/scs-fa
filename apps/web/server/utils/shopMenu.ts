import type { ShopMenuEntry } from "#shared/utils/menu"

/**
 * The shop menu for the agent files and the sitemap (story 12.15c), read from
 * the API at most every ten minutes like the rest of their data. A failed read
 * throws — Nitro caches no error — and the caller falls back to no menu.
 */
const cachedShopMenu = defineCachedFunction(
  async (): Promise<ShopMenuEntry[]> => {
    const { base, headers } = serverUpstream()
    return (await $fetch<{ data: ShopMenuEntry[] }>(`${base}/menu`, { headers })).data
  },
  { ...AGENT_FILE_CACHE, name: "shop-menu", getKey: () => "all" },
)

/** The menu, or none when the API cannot be reached: the files degrade, never fail. */
export function shopMenuOrNone(): Promise<ShopMenuEntry[]> {
  return cachedShopMenu().catch(() => [])
}
