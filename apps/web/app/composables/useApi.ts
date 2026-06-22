// A `$fetch`-like helper for the upstream API: it points at apiBase and attaches
// the bearer token on every request. On a 401 (access token expired) it makes a
// single silent refresh attempt via the BFF, then replays the request once. If
// the session is truly gone, it clears state and bounces to the right login
// screen (/admin/login for the admin area, /connexion for the storefront).
export function useApi() {
  const config = useRuntimeConfig()
  const apiBase = config.public.apiBase as string
  const { token, refresh } = useAuth()

  const base = $fetch.create({
    baseURL: apiBase,
    onRequest({ options }) {
      if (token.value) {
        const headers = new Headers(options.headers as HeadersInit)
        headers.set("Authorization", `Bearer ${token.value}`)
        options.headers = headers
      }
    },
  })

  function loginRedirect(): string {
    const path = useRoute().fullPath
    const target = path.startsWith("/admin") ? "/admin/login" : "/connexion"
    return `${target}?redirect=${encodeURIComponent(path)}`
  }

  return async function api<T = unknown>(url: string, options?: Parameters<typeof base>[1]): Promise<T> {
    try {
      return (await base(url, options)) as T
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status
      if (status !== 401) throw err

      const newToken = await refresh()
      if (newToken) {
        return (await base(url, options)) as T
      }
      if (import.meta.client) {
        await navigateTo(loginRedirect())
      }
      throw err
    }
  }
}
