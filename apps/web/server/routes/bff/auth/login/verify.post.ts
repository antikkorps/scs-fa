// BFF login, second step (story 12.8a): the mailed code, with the challenge
// the first step left in its httpOnly cookie. Opens the session like a login.
export default defineEventHandler(async (event) => {
  const challengeToken = readLoginChallengeCookie(event)
  if (!challengeToken) {
    throw createError({ statusCode: 401, data: { error: "InvalidLoginChallenge" }, message: "No login to finish" })
  }
  const { code } = await readBody<{ code?: unknown }>(event)
  return finishLogin(event, await callAuthApi(event, "/auth/login/verify", { challengeToken, code }))
})
