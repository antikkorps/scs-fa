// Story 12.10 — an administrator who signed in after the page loaded meets the
// waiting page on their first step into the site: the server confirms the
// session once, then they browse it like any other page.
export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return
  await useLaunch().recheckAdmin(to.path)
})
