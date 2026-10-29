/** What `GET /api/auth/me` answered: its status, and the account's role on a 200. */
export interface WhoAmIAnswer {
  status: number
  role?: string
}

interface AdminSessionCheck {
  accessToken: string | undefined
  hasRefreshToken: boolean
  whoAmI: (accessToken: string | undefined) => Promise<WhoAmIAnswer>
  /** Rotates the session; the new access token, or null when it is over. */
  refresh: () => Promise<string | null>
}

/**
 * Whether the visitor's session belongs to an administrator (story 12.10: they
 * browse the site behind the waiting page). The role comes from the API, never
 * from the browser's `scs_user` cookie, which anyone can write.
 */
export async function isAdminSession({
  accessToken,
  hasRefreshToken,
  whoAmI,
  refresh,
}: AdminSessionCheck): Promise<boolean> {
  if (!accessToken && !hasRefreshToken) return false
  try {
    let answer = await whoAmI(accessToken)
    if (answer.status === 401) {
      const rotated = await refresh()
      if (!rotated) return false
      answer = await whoAmI(rotated)
    }
    return answer.status === 200 && answer.role === "admin"
  } catch {
    return false
  }
}
