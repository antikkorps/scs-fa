// BFF login (story 12.8a): a new code for the pending login. The challenge
// lives on, so its cookie is renewed for the new code's lifetime.
export default defineEventHandler(async (event) => {
  const challengeToken = readLoginChallengeCookie(event)
  if (!challengeToken) {
    throw createError({ statusCode: 401, data: { error: "InvalidLoginChallenge" }, message: "No login to finish" })
  }
  const res = await callAuthApi<{ expiresIn: number }>(event, "/auth/login/resend", { challengeToken })
  setLoginChallengeCookie(event, challengeToken, res.expiresIn)
  return res
})
