// Pure presentation helpers — unit-tested in format.test.ts.

import type { ArtworkOrientation } from "@armurier/shared"

const EUROS = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" })

/** Format an amount as EUR (fr-FR), or an em dash when absent. */
export function formatEuros(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—"
  return EUROS.format(amount)
}

const DATETIME = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" })
const DATE = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" })

/** Format an ISO date string as a fr-FR date+time, or an em dash when absent/invalid. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : DATETIME.format(d)
}

/** Format an ISO date string as a fr-FR date (no time), or an em dash when absent/invalid. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : DATE.format(d)
}

/** Deterministic real-photo placeholder when an artwork has no image yet. */
export function fallbackImage(seed: string, w = 1200, h = 1500): string {
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`
}

/** Artwork image: the backend-provided URL when set, else a deterministic placeholder. */
export function artworkImage(featuredImageUrl: string | null | undefined, seed: string, w = 1200, h = 1500): string {
  return featuredImageUrl && featuredImageUrl.length > 0 ? featuredImageUrl : fallbackImage(seed, w, h)
}

/**
 * Display geometry for an artwork orientation: the CSS `aspect-ratio` plus the
 * intrinsic `width`/`height` to set on the <img> (avoids layout shift and sizes
 * the placeholder/`artworkImage` request to match). The catalogue mixes portrait
 * and landscape pieces, so the media adapts instead of cropping into a fixed box.
 */
export function artworkGeometry(orientation: ArtworkOrientation): {
  ratio: string
  width: number
  height: number
} {
  switch (orientation) {
    case "landscape":
      return { ratio: "3 / 2", width: 1200, height: 800 }
    case "square":
      return { ratio: "1 / 1", width: 1000, height: 1000 }
    default:
      return { ratio: "4 / 5", width: 800, height: 1000 }
  }
}

/** Human availability label for a limited edition. */
export function availabilityLabel(availableCount: number, editionLimit: number): string {
  if (availableCount <= 0) return "Édition épuisée"
  if (availableCount === 1) return "Dernier exemplaire"
  return `${availableCount} / ${editionLimit} disponibles`
}
