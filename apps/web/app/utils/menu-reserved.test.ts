import { readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { RESERVED_MENU_SLUGS } from "@armurier/shared"
import { describe, expect, it } from "vitest"

// Story 12.15b — a menu tab lives at /<slug>: the site's own top-level pages
// are reserved, and a page added here must join the list.
const PAGES = fileURLToPath(new URL("../pages", import.meta.url))
// Replaced by their menu pages in story 12.15c.
const MENU_PAGES = ["chasse", "coutellerie"]

describe("reserved menu slugs", () => {
  it("cover every top-level page of the site", () => {
    const routes = readdirSync(PAGES)
      .filter((name) => !name.includes(".test.") && !name.startsWith("index"))
      .map((name) => name.replace(/\.vue$/, ""))
      .filter((route) => !MENU_PAGES.includes(route))
    const missing = routes.filter((route) => !(RESERVED_MENU_SLUGS as readonly string[]).includes(route))
    expect(missing).toEqual([])
  })
})
