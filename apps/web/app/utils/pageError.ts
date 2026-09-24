/**
 * The error a detail page throws when its content could not be loaded
 * (story 9.6).
 *
 * Every detail page used to answer 404 on ANY failed fetch. A rate-limited,
 * slow or crashed API therefore told crawlers the page no longer existed — the
 * fastest way to get a whole catalogue dropped from the index. Only the API's
 * own 404 (or an empty answer) means "gone"; anything else is a temporary
 * outage, answered 503 so the page is retried, not forgotten.
 */
export function missingPageError(fetchError: { statusCode?: number } | null | undefined, notFoundMessage: string) {
  if (!fetchError || fetchError.statusCode === 404) {
    return createError({ statusCode: 404, statusMessage: notFoundMessage, fatal: true })
  }
  return createError({ statusCode: 503, statusMessage: "Page momentanément indisponible", fatal: true })
}
