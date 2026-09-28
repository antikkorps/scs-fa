import type { CollectedProduct } from "@armurier/shared"
import type { PoliteClient } from "./http.js"

/** What to collect: the whole catalogue, or only some of its categories. */
export interface CollectScope {
  /**
   * Case-insensitive patterns matched against the supplier's category labels
   * (e.g. "Couteaux pliants", "Optoélectronique"). Empty = the whole catalogue.
   */
  filters: string[]
}

/** True when a category label is within the scope. */
export function inScope(scope: CollectScope, label: string): boolean {
  return scope.filters.length === 0 || scope.filters.some((f) => new RegExp(f, "i").test(label))
}

/**
 * One supplier's site. An adapter only knows how to FIND product pages and
 * how to READ one; fetching, politeness, caching, validation and resuming are
 * the runner's job, the same for every supplier.
 */
export interface SupplierAdapter {
  /** Stable identifier: file names, config keys, CLI argument. */
  id: string
  /** Supplier name as it will appear in the back-office. */
  supplier: string
  origin: string
  discover(client: PoliteClient, scope: CollectScope): AsyncIterable<string>
  /** Read a product page; null when the page turns out not to be a product. */
  parse(html: string, url: string): CollectedProduct | null
}
