// The content the layout checks (Playwright, apps/web/e2e) browse, seeded by
// the API's e2e entrypoint. Shared so the two sides cannot drift apart.

/**
 * Fixed slugs of the e2e fixtures. The product carries a deliberately long
 * name with an unbreakable word: a layout that only holds with short demo
 * names is a layout that breaks on the first real catalogue import.
 */
export const E2E_FIXTURES = {
  product: "e2e-carabine-designation-longue",
  /** Reference category and tag the product is filed under. */
  category: "arme-longue",
  tag: "occasion",
  artist: "e2e-artiste",
  series: "e2e-serie",
  /** Reference theme (demo seed) the series belongs to. */
  theme: "cinema",
  artwork: "e2e-oeuvre",
  post: "e2e-article",
} as const
