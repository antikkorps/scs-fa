import type { NewsletterSegment } from "@armurier/shared"

// Provider-agnostic newsletter abstraction, mirroring StorageService: nothing
// Brevo-specific may leak past this file. Swapping the sending provider (or
// running the in-memory driver in tests) must not touch a single call site.
//
// The application database — not the provider — is the source of truth for
// consent. These calls only mirror a state we already recorded and timestamped
// locally, which is why every one of them is idempotent and why a failure is
// recoverable by replaying it.

export interface SyncContactParams {
  email: string
  /** Confirmed segments, exhaustive: the provider ends up subscribed to exactly these. */
  segments: NewsletterSegment[]
}

export interface NewsletterService {
  /**
   * Create or update the contact so it belongs to exactly `segments` — including
   * removing it from the segments it is no longer subscribed to. Idempotent.
   */
  syncContact(params: SyncContactParams): Promise<void>
  /** Erase the contact at the provider (last segment withdrawn, or GDPR erasure). */
  deleteContact(email: string): Promise<void>
}
