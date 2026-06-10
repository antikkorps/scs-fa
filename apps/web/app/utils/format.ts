// Pure presentation helpers — unit-tested in format.test.ts.

const EUROS = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" })

/** Format an amount as EUR (fr-FR), or an em dash when absent. */
export function formatEuros(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—"
  return EUROS.format(amount)
}

/** Deterministic real-photo placeholder when an artwork has no image yet. */
export function fallbackImage(seed: string, w = 1200, h = 1500): string {
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`
}

/** Artwork image: the backend-provided URL when set, else a deterministic placeholder. */
export function artworkImage(featuredImageUrl: string | null | undefined, seed: string, w = 1200, h = 1500): string {
  return featuredImageUrl && featuredImageUrl.length > 0 ? featuredImageUrl : fallbackImage(seed, w, h)
}

/** Human availability label for a limited edition. */
export function availabilityLabel(availableCount: number, editionLimit: number): string {
  if (availableCount <= 0) return "Édition épuisée"
  if (availableCount === 1) return "Dernier exemplaire"
  return `${availableCount} / ${editionLimit} disponibles`
}
