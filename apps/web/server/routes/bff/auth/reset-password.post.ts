// BFF reset-password: thin proxy. Upstream validates the token and new password
// and returns the appropriate status (200 / 400 / 401).
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  return callAuthApi(event, "/auth/reset-password", body)
})
