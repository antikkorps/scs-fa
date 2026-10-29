// Story 12.10 — the launch state for a page that was not server-rendered (the
// back-office is a client-only app) or for an administrator who has just signed
// in: the server checks the session, the browser only reads the answer.
export default defineEventHandler(async (event) => {
  setResponseHeader(event, "cache-control", "no-store")
  return launchContext(event)
})
