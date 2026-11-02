import type { LocationQuery } from "vue-router"

/**
 * An "add to cart" started without an account survives the login or the
 * sign-up (UX audit 2026-11-01, I3). The item travels in the way back
 * (`?<param>=<id>`, see `loginForCartPath`); once the visitor is back on the
 * page and signed in, the id is cleared from the address first — a reload or
 * the back button must not add it twice — then handed to `replay`.
 */
export function useCartIntent(param: string, replay: (id: string) => Promise<void>) {
  const route = useRoute()
  const { isAuthenticated } = useAuth()
  const { salesOpen } = useLaunch()

  onMounted(async () => {
    const id = route.query[param]
    if (typeof id !== "string" || !isAuthenticated.value || !salesOpen.value) return
    await navigateTo({ path: route.path, query: queryWithout(route.query, param) }, { replace: true })
    await replay(id)
  })

  /** Where to send a visitor without an account who wants this item. */
  function loginPath(id: string): string {
    return loginForCartPath(route.path, { [param]: id })
  }

  return { loginPath }
}

function queryWithout(query: LocationQuery, param: string): LocationQuery {
  return Object.fromEntries(Object.entries(query).filter(([key]) => key !== param))
}
