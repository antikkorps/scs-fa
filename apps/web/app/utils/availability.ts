// Availability of a purchasable item, shared by both universes (story 11.3).
//
// The distinction that matters commercially: a **unique piece** that is gone is
// gone for good, while an ordinary product at zero stock will come back. Saying
// "Rupture" on a sold historical weapon would promise a restock that can never
// happen — and would tell search engines the wrong thing, since schema.org has
// separate values for the two situations.

export type AvailabilityState = "available" | "sold" | "out_of_stock"

export function availabilityState(item: { stockQty?: number | null; isUnique?: boolean | null }): AvailabilityState {
  const inStock = (item.stockQty ?? 0) > 0
  if (inStock) return "available"
  return item.isUnique ? "sold" : "out_of_stock"
}

const LABELS: Record<AvailabilityState, string> = {
  available: "Disponible",
  sold: "Vendu",
  out_of_stock: "Rupture",
}

/** Short label for a badge on a card. */
export function availabilityBadgeLabel(state: AvailabilityState): string {
  return LABELS[state]
}

const DETAIL_LABELS: Record<AvailabilityState, string> = {
  available: "Disponible",
  sold: "Vendu — indisponible",
  out_of_stock: "Rupture de stock",
}

/** Fuller wording for a product page, where there is room to be explicit. */
export function availabilityLongLabel(state: AvailabilityState): string {
  return DETAIL_LABELS[state]
}

const SCHEMA_URLS: Record<AvailabilityState, string> = {
  available: "https://schema.org/InStock",
  // A one-off that has been sold: never coming back.
  sold: "https://schema.org/SoldOut",
  // Out of stock, but the listing stays indexable because it will restock.
  out_of_stock: "https://schema.org/OutOfStock",
}

export function availabilitySchemaUrl(state: AvailabilityState): string {
  return SCHEMA_URLS[state]
}

export function isPurchasable(state: AvailabilityState): boolean {
  return state === "available"
}
