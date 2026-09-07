// Newsletter segmentation (story 11.4).
//
// A segment is what someone SUBSCRIBED to, not what an issue is allowed to talk
// about: a letter sent to the "collection" segment may perfectly well mention a
// Gun Art release. The segment decides *who receives*, never *what may be
// written* — do not partition editorial content by segment.
//
// Segments are structural (they drive the DB enum, the consent rows and the
// provider list mapping), so they live here rather than in the database as
// editable rows.
export const NEWSLETTER_SEGMENTS = ["armurerie", "collection", "gun_art"] as const
export type NewsletterSegment = (typeof NEWSLETTER_SEGMENTS)[number]

// Lifecycle of ONE subscription (contact × segment).
// `pending` = address captured, double opt-in not confirmed yet → never mailed.
// `confirmed` = opt-in proven, timestamped → the only state that gets mailed.
// `unsubscribed` = consent withdrawn, kept as a trace once the address is purged.
export const NEWSLETTER_SUBSCRIPTION_STATUS = ["pending", "confirmed", "unsubscribed"] as const
export type NewsletterSubscriptionStatus = (typeof NEWSLETTER_SUBSCRIPTION_STATUS)[number]

// Confirmation links are short-lived; unsubscribe links must keep working for as
// long as the address exists (they travel in every letter we send).
export const NEWSLETTER_CONFIRM_TOKEN_TTL_HOURS = 72

/** Wording shown next to each opt-in checkbox (front + transactional emails). */
export const NEWSLETTER_SEGMENT_LABELS: Record<NewsletterSegment, string> = {
  armurerie: "Armurerie — nouveautés, réassorts et conseils",
  collection: "Armes de collection — pièces historiques et arrivages",
  gun_art: "Gun Art — nouvelles séries et tirages limités",
}
