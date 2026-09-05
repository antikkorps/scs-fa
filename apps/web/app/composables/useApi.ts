// A `$fetch`-like helper for authenticated API calls. It routes through the
// same-origin BFF proxy (/bff/api/*), which attaches the bearer from the
// httpOnly access cookie and transparently refreshes the session server-side.
// The access token never touches client JS. On a 401 (session truly gone) it
// bounces to the right login screen (/admin/login for admin, /connexion else).
export function useApi() {
  // useRequestFetch forwards the incoming request's cookies during SSR, so the
  // httpOnly session cookie reaches the proxy on server-rendered calls too.
  const request = useRequestFetch()

  function loginRedirect(): string {
    const path = useRoute().fullPath
    const target = path.startsWith("/admin") ? "/admin/login" : "/connexion"
    return `${target}?redirect=${encodeURIComponent(path)}`
  }

  return async function api<T = unknown>(url: string, options?: Parameters<typeof request>[1]): Promise<T> {
    const path = url.startsWith("/") ? url : `/${url}`
    try {
      return (await request(`/bff/api${path}`, options)) as T
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status
      if (status === 401 && import.meta.client) {
        await navigateTo(loginRedirect())
      }
      throw err
    }
  }
}
