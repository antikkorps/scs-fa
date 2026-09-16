import { createLaPosteProvider } from "./laposte.js"
import { createMondialRelayProvider } from "./mondial-relay.js"
import type { TrackingProvider } from "./types.js"

/**
 * The carriers we can ask, chosen once at startup from the configured credentials.
 *
 * Absent credentials are not an error: the carriers we cannot ask simply stay
 * manual, which is where every carrier was before this story. A partial rollout
 * (La Poste configured, Mondial Relay not) is a supported, ordinary state.
 */
function createProviders(): TrackingProvider[] {
  const candidates: (TrackingProvider | null)[] = [createLaPosteProvider(), createMondialRelayProvider()]
  return candidates.filter((p) => p !== null)
}

const providers = createProviders()

export function trackingProviderFor(carrier: string): TrackingProvider | null {
  return providers.find((p) => p.carriers.includes(carrier)) ?? null
}

/** Carrier codes an automatic sync can currently answer for — empty when none is configured. */
export function trackedCarriers(): string[] {
  return providers.flatMap((p) => [...p.carriers])
}

export type { TrackingProvider, TrackingResult, TrackingState } from "./types.js"
