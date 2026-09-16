// Story 11.9b — automatic carrier tracking.
//
// Provider-agnostic abstraction, mirroring StorageService and NewsletterService:
// nothing carrier-specific may leak past this file. A parcel's status stays OURS
// — the carrier only ever tells us "it arrived", and we decide what to record.

/**
 * What a carrier says about a parcel, reduced to what we can act on.
 *
 * Deliberately narrower than what carriers report: our parcels only know
 * `preparing`, `shipped` and `delivered`, so a held or failed delivery has no
 * status to move to. The carrier's own words survive in `label`, which is what
 * an admin actually reads when something looks wrong.
 */
export type TrackingState = "in_transit" | "delivered" | "unknown"

export interface TrackingResult {
  state: TrackingState
  /** The carrier's latest event, in its own words. Null when it said nothing. */
  label: string | null
  /** When the carrier says it was delivered — null unless `state` is "delivered". */
  deliveredAt: Date | null
}

export interface TrackingProvider {
  /** Carrier codes (from SHIPPING_CARRIERS) this provider can answer for. */
  readonly carriers: readonly string[]
  /**
   * Ask the carrier where a parcel is.
   *
   * Throws on a transport or credential failure — the caller leaves the parcel
   * untouched and retries on the next run. It must NEVER answer "delivered" on
   * a doubt: an unrecognised state is `unknown`, which changes nothing.
   */
  fetchStatus(trackingNumber: string): Promise<TrackingResult>
}

export const UNKNOWN_TRACKING: TrackingResult = { state: "unknown", label: null, deliveredAt: null }
