// Story 12.15e — the common calibres, so the shop only tags its ammunition:
// smooth bores, then hunting rifles, then sport shooting. A calibre no product
// carries stays out of the catalogue's list. Fred trims or reorders them in Tags.

const CALIBRES: [slug: string, name: string][] = [
  ["12", "12"],
  ["16", "16"],
  ["20", "20"],
  ["410", "410 (36)"],
  ["243-win", ".243 Win"],
  ["6-5-creedmoor", "6,5 Creedmoor"],
  ["6-5x55", "6,5×55"],
  ["270-win", ".270 Win"],
  ["7x64", "7×64"],
  ["7x65r", "7×65 R"],
  ["7mm-rem-mag", "7 mm Rem Mag"],
  ["308-win", ".308 Win"],
  ["30-06", ".30-06"],
  ["300-win-mag", ".300 Win Mag"],
  ["8x57-js", "8×57 JS"],
  ["9-3x62", "9,3×62"],
  ["9-3x74r", "9,3×74 R"],
  ["22-lr", ".22 LR"],
  ["9x19", "9×19 (9 mm Para)"],
  ["38-special", ".38 Special"],
  ["357-magnum", ".357 Magnum"],
  ["45-acp", ".45 ACP"],
  ["223-rem", ".223 Rem"],
  ["7-62x39", "7,62×39"],
]

// The prefix keeps a bare number (« 12 ») free for any other tag.
export const CALIBRE_TAGS = CALIBRES.map(([slug, name], index) => ({
  slug: `calibre-${slug}`,
  name,
  facet: "calibre" as const,
  displayOrder: index + 1,
  description: `Calibre ${name}`,
}))
