import type { LaunchState } from "~/composables/useLaunch"

// Story 12.10 — the launch state this page renders with. The server works it
// out for every page request (server/middleware/launch.ts) and hands it over in
// the payload; a page the server did not render (the back-office) asks the BFF.
export default defineNuxtPlugin(async () => {
  const launch = useState<LaunchState | null>("launch", () => null)
  if (import.meta.server) {
    launch.value = (useRequestEvent()?.context.launch as LaunchState | undefined) ?? null
    return
  }
  if (launch.value === null) await useLaunch().refresh()
})
