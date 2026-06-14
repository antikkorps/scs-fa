// A `$fetch` instance pre-configured for the admin API: it points at apiBase and
// attaches the bearer token on every request. A 401 means the session expired —
// clear it and bounce to the login screen.
export function useApi() {
  const config = useRuntimeConfig()
  const apiBase = config.public.apiBase as string
  const token = useCookie<string | null>("scs_admin_token")
  const user = useCookie<unknown>("scs_admin_user")

  return $fetch.create({
    baseURL: apiBase,
    onRequest({ options }) {
      if (token.value) {
        const headers = new Headers(options.headers as HeadersInit)
        headers.set("Authorization", `Bearer ${token.value}`)
        options.headers = headers
      }
    },
    onResponseError({ response }) {
      if (response.status === 401) {
        token.value = null
        user.value = null
        if (import.meta.client) {
          const redirect = encodeURIComponent(useRoute().fullPath)
          navigateTo(`/admin/login?redirect=${redirect}`)
        }
      }
    },
  })
}
