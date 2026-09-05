import type { H3Event } from "h3"

// Neither session token reaches client-side JS: both live in httpOnly cookies
// managed exclusively by the BFF. The refresh token is read/written by the
// /bff/auth/* routes; the access token is attached as the bearer by the
// /bff/api/* proxy (server/routes/bff/api/[...].ts). The browser only ever sees
// a non-secret `scs_user` cookie (set client-side) for UI state.
export const REFRESH_COOKIE = "scs_refresh"
export const ACCESS_COOKIE = "scs_token"

// Matches the API refresh-token TTL (JWT_REFRESH_EXPIRES_IN, default 7d).
const REFRESH_MAX_AGE = 60 * 60 * 24 * 7
// The cookie outlives the short-lived JWT it carries (refreshed on 401); its
// lifetime just bounds how long a session can be resurrected via refresh.
const ACCESS_MAX_AGE = 60 * 60 * 24 * 7

const httpOnlyOpts = {
  httpOnly: true,
  // No `secure` on http://localhost in dev, otherwise the cookie is dropped.
  secure: !import.meta.dev,
  sameSite: "lax",
  path: "/",
} as const

export function setRefreshCookie(event: H3Event, token: string): void {
  setCookie(event, REFRESH_COOKIE, token, { ...httpOnlyOpts, maxAge: REFRESH_MAX_AGE })
}

export function readRefreshCookie(event: H3Event): string | undefined {
  return getCookie(event, REFRESH_COOKIE)
}

export function clearRefreshCookie(event: H3Event): void {
  deleteCookie(event, REFRESH_COOKIE, { path: "/" })
}

export function setAccessCookie(event: H3Event, token: string): void {
  setCookie(event, ACCESS_COOKIE, token, { ...httpOnlyOpts, maxAge: ACCESS_MAX_AGE })
}

export function readAccessCookie(event: H3Event): string | undefined {
  return getCookie(event, ACCESS_COOKIE)
}

export function clearAccessCookie(event: H3Event): void {
  deleteCookie(event, ACCESS_COOKIE, { path: "/" })
}

/**
 * Rotate the session server-side: exchange the httpOnly refresh cookie for a
 * fresh access+refresh pair, persist both httpOnly cookies, and return the new
 * access token. Returns null (and clears the cookies) when there's no valid
 * session — used by the /bff/api proxy on a 401 and by /bff/auth/refresh.
 */
export async function refreshSession(event: H3Event): Promise<string | null> {
  const refreshToken = readRefreshCookie(event)
  if (!refreshToken) return null
  try {
    const res = await callAuthApi<{ accessToken: string; refreshToken: string }>(event, "/auth/refresh", {
      refreshToken,
    })
    setRefreshCookie(event, res.refreshToken)
    setAccessCookie(event, res.accessToken)
    return res.accessToken
  } catch {
    clearRefreshCookie(event)
    clearAccessCookie(event)
    return null
  }
}

// Forwards a call to the upstream auth API and re-throws upstream errors with
// their original status + payload, so client pages can react to 401/409/423/etc.
export async function callAuthApi<T>(event: H3Event, path: string, body: Record<string, unknown>): Promise<T> {
  const apiBase = useRuntimeConfig(event).public.apiBase as string
  try {
    return (await $fetch(`${apiBase}${path}`, { method: "POST", body })) as T
  } catch (err) {
    const e = err as { response?: { status?: number }; data?: unknown }
    throw createError({
      statusCode: e.response?.status ?? 502,
      data: e.data ?? { error: "UpstreamError" },
      message: "Auth request failed",
    })
  }
}
