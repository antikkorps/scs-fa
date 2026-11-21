import { describe, expect, it } from "vitest"
import { menuPages, menuShortcuts, type ShopMenuEntry } from "./menu"

const filter = (fields: Partial<NonNullable<ShopMenuEntry["filter"]>>) => ({
  category: null,
  subcategory: null,
  tags: [],
  legalCategory: null,
  ...fields,
})

const entry = (path: string, fields: Partial<ShopMenuEntry> = {}): ShopMenuEntry => ({
  slug: path.split("/").at(-1) ?? "",
  label: path,
  path,
  kind: "filter",
  href: path,
  filter: filter({}),
  children: [],
  ...fields,
})

const MENU: ShopMenuEntry[] = [
  entry("/chasse", {
    filter: filter({ tags: ["chasse"] }),
    children: [
      entry("/chasse/armes-longues", { filter: filter({ category: "arme-longue", tags: ["chasse"] }) }),
      entry("/chasse/accessoires", {
        kind: "group",
        href: null,
        filter: null,
        children: [entry("/chasse/accessoires/nettoyage", { filter: filter({ category: "entretien" }) })],
      }),
    ],
  }),
  entry("/munitions", { filter: filter({ category: "munition" }) }),
  entry("/coutellerie", { filter: filter({ category: "coutellerie" }) }),
  entry("/atelier", { kind: "link", href: "/blog/atelier", filter: null }),
]

// Story 12.15c — the menu's pages, for the sitemap and llms.txt.
describe("menuPages", () => {
  it("lists every entry with a page, depth first, never a heading nor a link", () => {
    expect(menuPages(MENU).map((page) => page.path)).toEqual([
      "/chasse",
      "/chasse/armes-longues",
      "/chasse/accessoires/nettoyage",
      "/munitions",
      "/coutellerie",
    ])
  })
})

// An entry showing exactly one category or one tag stands for its page (decision of 2026-11-21).
describe("menuShortcuts", () => {
  const shortcuts = menuShortcuts(MENU)

  it("maps a category or a tag to the entry showing exactly it", () => {
    expect(shortcuts.categories.get("munition")).toBe("/munitions")
    expect(shortcuts.categories.get("entretien")).toBe("/chasse/accessoires/nettoyage")
    expect(shortcuts.tags.get("chasse")).toBe("/chasse")
  })

  it("ignores an entry that narrows further", () => {
    expect(shortcuts.categories.has("arme-longue")).toBe(false)
  })

  it("keeps the first entry when two show the same", () => {
    const twice = menuShortcuts([...MENU, entry("/bis", { filter: filter({ category: "munition" }) })])
    expect(twice.categories.get("munition")).toBe("/munitions")
  })
})
