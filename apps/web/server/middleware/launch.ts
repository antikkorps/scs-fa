import { isPageRequest } from "#shared/utils/launch"

// Story 12.10. Until robots may index the site, every response says so — a
// header rather than robots.txt, which must block nothing or the noindex would
// never be read. A page render also learns how far the shop is open, for the
// app to show the waiting page (plugins/launch.ts).
export default defineEventHandler(async (event) => {
  const status = await shopStatus()
  if (!status.indexingEnabled) setResponseHeader(event, "x-robots-tag", "noindex")
  if (isPageRequest(event.method, event.path)) event.context.launch = await launchContext(event)
})
