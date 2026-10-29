import { type LaunchStage, salesAreOpen } from "@armurier/shared"
import { showsWaitingPage } from "#shared/utils/launch"

/** How far the shop is open (story 12.10), as the server worked it out for this visitor. */
export interface LaunchState {
  launchStage: LaunchStage
  indexingEnabled: boolean
  /** A signed-in administrator, checked by the server: sees the site behind the waiting page. */
  adminPreview: boolean
}

// Until the server has said otherwise: closed. Showing an unfinished shop by
// mistake is the failure that matters; the API refuses the sale either way.
const CLOSED: LaunchState = { launchStage: "coming_soon", indexingEnabled: false, adminPreview: false }

// Filled during the server render (plugins/launch.ts), or asked of the BFF when
// the page was not server-rendered (the back-office is a client-only app).
export function useLaunch() {
  const state = useState<LaunchState | null>("launch", () => null)
  // The admin re-check below happens once per page load.
  const adminChecked = useState("launch-admin-checked", () => false)
  const { isAdmin } = useAuth()

  const status = computed(() => state.value ?? CLOSED)
  const salesOpen = computed(() => salesAreOpen(status.value.launchStage))

  function waitingPageFor(path: string): boolean {
    return showsWaitingPage({ stage: status.value.launchStage, adminPreview: status.value.adminPreview, path })
  }

  async function refresh(): Promise<void> {
    try {
      state.value = await $fetch<LaunchState>("/bff/launch-status")
    } catch {
      // Keep what was known: the next navigation asks again.
    }
  }

  /**
   * An administrator who signed in after this page loaded (in the client-only
   * back-office) would still meet the waiting page: the `scs_user` cookie says
   * who they claim to be, the server says whether it is true.
   */
  async function recheckAdmin(path: string): Promise<void> {
    if (adminChecked.value || !isAdmin.value || !waitingPageFor(path)) return
    adminChecked.value = true
    await refresh()
  }

  return { status, salesOpen, waitingPageFor, refresh, recheckAdmin }
}
