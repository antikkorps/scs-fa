import type { H3Event } from "h3"
import { upstreamHeaders } from "#shared/utils/upstream"
import { isAdminSession, type WhoAmIAnswer } from "./adminSession"
import { readAccessCookie, readRefreshCookie, refreshSession } from "./auth-cookies"
import { createShopStatusLoader, type ShopStatus } from "./shopStatus"
import { apiUpstream } from "./upstream"

// Story 12.10 — the shop status is the same for every visitor: one call to the
// API every few seconds, made in the server's own name (no visitor IP to forward).
const STATUS_TTL_MS = 10_000
const STATUS_TIMEOUT_MS = 3_000

const loadShopStatus = createShopStatusLoader(
  async () => {
    const config = useRuntimeConfig()
    const base = (config.apiInternalBase as string) || (config.public.apiBase as string)
    const res = await $fetch<{ data: ShopStatus }>(`${base}/shop-status`, {
      headers: upstreamHeaders(undefined, config.internalApiSecret as string),
      timeout: STATUS_TIMEOUT_MS,
    })
    return res.data
  },
  { ttlMs: STATUS_TTL_MS },
)

export function shopStatus(): Promise<ShopStatus> {
  return loadShopStatus()
}

/** The launch state of this request: the shop status, and whether an administrator is browsing. */
export interface LaunchContext extends ShopStatus {
  adminPreview: boolean
}

export async function launchContext(event: H3Event): Promise<LaunchContext> {
  const status = await shopStatus()
  // Only the waiting page needs to know: past it, nobody is asked anything.
  const adminPreview = status.launchStage === "coming_soon" && (await sessionIsAdmin(event))
  return { ...status, adminPreview }
}

function sessionIsAdmin(event: H3Event): Promise<boolean> {
  const { base, headers } = apiUpstream(event)
  const whoAmI = async (token: string | undefined): Promise<WhoAmIAnswer> => {
    const res = await $fetch.raw<{ role?: string }>(`${base}/auth/me`, {
      headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ignoreResponseError: true,
      timeout: STATUS_TIMEOUT_MS,
    })
    return { status: res.status, role: res._data?.role }
  }
  return isAdminSession({
    accessToken: readAccessCookie(event),
    hasRefreshToken: Boolean(readRefreshCookie(event)),
    whoAmI,
    refresh: () => refreshSession(event),
  })
}
