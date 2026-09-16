import { env } from "../../env.js"
import { interpretLaPosteShipment, type LaPosteShipment } from "./interpret.js"
import type { TrackingProvider, TrackingResult } from "./types.js"
import { UNKNOWN_TRACKING } from "./types.js"

const LAPOSTE_API_BASE = "https://api.laposte.fr/suivi/v2"
const REQUEST_TIMEOUT_MS = 10_000

/**
 * La Poste "Suivi v2", spoken over plain `fetch` — one endpoint does not justify
 * a dependency to quarantine and upgrade forever (same call as the Brevo driver).
 *
 * One key covers THREE of our carriers: the v2 service harmonises tracked mail,
 * Colissimo and Chronopost behind a single tracking number.
 */
export class LaPosteTrackingProvider implements TrackingProvider {
  readonly carriers = ["colissimo", "chronopost"] as const

  private readonly apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async fetchStatus(trackingNumber: string): Promise<TrackingResult> {
    const url = `${LAPOSTE_API_BASE}/idships/${encodeURIComponent(trackingNumber)}?lang=fr_FR`
    const response = await fetch(url, {
      headers: { "X-Okapi-Key": this.apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    // An unknown tracking number is an answer, not an incident: the carrier may
    // simply not have registered the parcel yet. Anything else is a real failure
    // and must surface, so the run retries rather than silently doing nothing.
    if (response.status === 404) return UNKNOWN_TRACKING
    if (!response.ok) {
      throw new Error(`La Poste tracking failed (${response.status}) for ${trackingNumber}`)
    }

    const body = (await response.json()) as { shipment?: LaPosteShipment }
    return interpretLaPosteShipment(body.shipment)
  }
}

/** The provider, or null when no key is configured — tracking is then simply manual. */
export function createLaPosteProvider(): LaPosteTrackingProvider | null {
  return env.LAPOSTE_OKAPI_KEY ? new LaPosteTrackingProvider(env.LAPOSTE_OKAPI_KEY) : null
}
