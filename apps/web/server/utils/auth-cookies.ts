import type { H3Event } from "h3"

// The refresh token never reaches client-side JS: it lives in an httpOnly+secure
// cookie that only the BFF auth routes (server/api/auth/*) read and write. The
// access token, by contrast, is returned to the client so $fetch can attach the
// bearer header (see app/composables/useApi.ts).
export const REFRESH_COOKIE = "scs_refresh"

// Matches the API refresh-token TTL (JWT_REFRESH_EXPIRES_IN, default 7d).
const REFRESH_MAX_AGE = 60 * 60 * 24 * 7

export function setRefreshCookie(event: H3Event, token: string): void {
  setCookie(event, REFRESH_COOKIE, token, {
    httpOnly: true,
    // No `secure` on http://localhost in dev, otherwise the cookie is dropped.
    secure: !import.meta.dev,
    sameSite: "lax",
    path: "/",
    maxAge: REFRESH_MAX_AGE,
  })
}

export function readRefreshCookie(event: H3Event): string | undefined {
  return getCookie(event, REFRESH_COOKIE)
}

export function clearRefreshCookie(event: H3Event): void {
  deleteCookie(event, REFRESH_COOKIE, { path: "/" })
}

// Forwards a call to the upstream auth API and re-throws upstream errors with
// their original status + payload, so client pages can react to 401/409/423/etc.
export async function callAuthApi<T>(
  event: H3Event,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
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
