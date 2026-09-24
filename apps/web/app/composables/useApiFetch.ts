import type { UseFetchOptions } from "nuxt/app"

/**
 * `useFetch` for the public API (story 9.6). Takes a path relative to the API
 * (`/products`), and goes through `$apiFetch`, which calls the API on the
 * private network during SSR, on behalf of the visitor — see
 * app/plugins/api-fetch.ts.
 */
export function useApiFetch<T>(path: string | (() => string), options: UseFetchOptions<T> = {}) {
  return useFetch(path, { ...options, $fetch: useNuxtApp().$apiFetch as typeof $fetch })
}
