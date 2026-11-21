import { readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { RESERVED_MENU_SLUGS } from "@armurier/shared"
import { describe, expect, it } from "vitest"

// Story 12.15b — a menu tab lives at /<slug>: the site's own top-level pages
// are reserved, and a page added here must join the list.
const PAGES = fileURLToPath(new URL("../pages", import.meta.url))

describe("reserved menu slugs", () => {
  it("cover every top-level page of the site", () => {
    const routes = readdirSync(PAGES)
      // `[...menuPath]` is the menu itself (story 12.15c).
      .filter((name) => !name.includes(".test.") && !name.startsWith("index") && !name.startsWith("["))
      .map((name) => name.replace(/\.vue$/, ""))
    const missing = routes.filter((route) => !(RESERVED_MENU_SLUGS as readonly string[]).includes(route))
    expect(missing).toEqual([])
  })
})
