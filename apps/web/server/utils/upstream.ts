import type { H3Event } from "h3"
import { upstreamHeaders } from "#shared/utils/upstream"

/** Base URL and headers for a server-side call to the API on behalf of `event`'s visitor. */
export function apiUpstream(event: H3Event): { base: string; headers: Record<string, string> } {
  const config = useRuntimeConfig(event)
  const base = (config.apiInternalBase as string) || (config.public.apiBase as string)
  const clientIp = getRequestIP(event, { xForwardedFor: true })
  const userAgent = getRequestHeader(event, "user-agent")
  return { base, headers: upstreamHeaders(clientIp, config.internalApiSecret as string, userAgent) }
}

/**
 * Base URL and headers for a call made in the server's own name: data shared by
 * every visitor (shop status, cached agent files), so no visitor's IP or user
 * agent is charged with it.
 */
export function serverUpstream(): { base: string; headers: Record<string, string> } {
  const config = useRuntimeConfig()
  const base = (config.apiInternalBase as string) || (config.public.apiBase as string)
  return { base, headers: upstreamHeaders(undefined, config.internalApiSecret as string) }
}
