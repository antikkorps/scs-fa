// BFF forgot-password: thin proxy. The API responds the same way whether or not
// the email exists (anti-enumeration), so we just forward the body.
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  return callAuthApi(event, "/auth/forgot-password", body)
})
