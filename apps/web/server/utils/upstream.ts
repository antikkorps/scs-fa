import type { H3Event } from "h3"

/** Base URL and headers for a server-side call to the API on behalf of `event`'s visitor. */
export function apiUpstream(event: H3Event): { base: string; headers: Record<string, string> } {
  const config = useRuntimeConfig(event)
  const base = (config.apiInternalBase as string) || (config.public.apiBase as string)
  const clientIp = getRequestIP(event, { xForwardedFor: true })
  return { base, headers: upstreamHeaders(clientIp, config.internalApiSecret as string) }
}
