// Story 12.7c — what became of a customer e-mail once it left our SMTP relay.
//
// Provider-agnostic, like NewsletterService: everything a sending provider does
// its own way (how it authenticates its reports, how it names its events, the
// header that carries our id) lives in one adapter of this folder. The webhook,
// the journal and the back-office only ever see these types, so changing
// provider means writing one adapter and changing the .env, nothing else.

/** The outcomes worth an admin's eye. Passing ones (soft bounce, deferred) and engagement are left out. */
export const DELIVERY_OUTCOMES = ["delivered", "hard_bounce", "blocked", "spam"] as const
export type DeliveryOutcome = (typeof DELIVERY_OUTCOMES)[number]

export interface DeliveryReport {
  /** Our own id for the e-mail, journaled at sending and echoed back by the provider. */
  trackingId: string
  outcome: DeliveryOutcome
}

export interface DeliveryProvider {
  /** Headers that make the provider echo `trackingId` in its reports. */
  trackingHeaders(trackingId: string): Record<string, string>
  /** The shared secret the provider presented with its call, if any. */
  presentedSecret(authorization: string | undefined): string | null
  /**
   * The reports worth recording, in our vocabulary — or null when the body is
   * not one of the provider's report payloads at all.
   */
  parseReports(body: unknown): DeliveryReport[] | null
}
