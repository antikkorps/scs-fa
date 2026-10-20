// BFF login: proxies to the API. A session goes into httpOnly cookies and only
// the (non-secret) user is returned for UI state; an account that confirms by
// mailed code gets its challenge cookie instead (story 12.8a, see finishLogin).
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  return finishLogin(event, await callAuthApi(event, "/auth/login", body))
})
