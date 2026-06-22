import type { AuthUser } from "~/types/admin"

interface ApiLoginResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
  user: AuthUser
}

// BFF register: creates the account (API /auth/register returns the user but no
// tokens), then immediately logs in so the visitor lands signed-in. The refresh
// token goes into the httpOnly cookie, exactly like the login route.
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  await callAuthApi(event, "/auth/register", body)

  const res = await callAuthApi<ApiLoginResponse>(event, "/auth/login", {
    email: body.email,
    password: body.password,
  })

  setRefreshCookie(event, res.refreshToken)

  return { accessToken: res.accessToken, expiresIn: res.expiresIn, user: res.user }
})
