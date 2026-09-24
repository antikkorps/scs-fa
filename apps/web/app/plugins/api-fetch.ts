import { getRequestIP } from "h3"
import { upstreamHeaders } from "#shared/utils/upstream"

/**
 * `$apiFetch`: the fetcher for public API reads (story 9.6), behind
 * `useApiFetch`.
 *
 * In the browser it targets the public API origin. During SSR it targets the
 * API over the private network and forwards the visitor's IP plus the shared
 * secret (see server/utils/upstream.ts) — per request, since a plugin runs once
 * per server render, so no visitor's IP can leak into another's call.
 */
export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()

  if (import.meta.server) {
    const event = useRequestEvent()
    const clientIp = event ? getRequestIP(event, { xForwardedFor: true }) : undefined
    return {
      provide: {
        apiFetch: $fetch.create({
          baseURL: (config.apiInternalBase as string) || (config.public.apiBase as string),
          headers: upstreamHeaders(clientIp, config.internalApiSecret as string),
        }),
      },
    }
  }

  return { provide: { apiFetch: $fetch.create({ baseURL: config.public.apiBase as string }) } }
})
