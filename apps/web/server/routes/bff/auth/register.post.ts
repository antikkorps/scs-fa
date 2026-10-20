// BFF register: creates the account (API /auth/register returns the user but no
// tokens), then immediately logs in so the visitor lands signed-in. The refresh
// token goes into the httpOnly cookie, exactly like the login route (finishLogin).
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  await callAuthApi(event, "/auth/register", body)

  return finishLogin(event, await callAuthApi(event, "/auth/login", { email: body.email, password: body.password }))
})
