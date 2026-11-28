import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

// A stored image renders as <picture><img></picture>: the <img> is not the
// component's root, so a caller's scoped selector never reaches it. Its
// `height` attribute then wins and the photo is stretched. A caller styles it
// through `:deep()` only.
const APP = join(__dirname, "..")

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return vueFiles(path)
    return entry.name.endsWith(".vue") ? [path] : []
  })
}

/** The classes a file hands to its <ResponsiveImage>, which land on the <img>. */
function imageClasses(source: string): string[] {
  // Quoted values may hold a `>` (`:loading="index > 3 ? …"`).
  const tags = source.match(/<ResponsiveImage\b(?:"[^"]*"|'[^']*'|[^'">])*>/g) ?? []
  return tags.flatMap((tag) => tag.match(/\sclass="([^"]+)"/)?.[1]?.split(/\s+/) ?? [])
}

/** The selectors of every scoped style block, `:deep(...)` parts taken out. */
function scopedSelectors(source: string): string[] {
  const blocks = source.matchAll(/<style\b[^>]*\bscoped\b[^>]*>([\s\S]*?)<\/style>/g)
  const style = [...blocks].map((block) => block[1]).join("\n")
  const withoutComments = style.replace(/\/\*[\s\S]*?\*\//g, "")
  const selectors = withoutComments.match(/[^{}]+(?=\{)/g) ?? []
  return selectors.map((selector) => selector.replace(/:deep\([^)]*\)/g, "").trim())
}

function reachesImage(selector: string, classes: string[]): boolean {
  if (/(^|[\s>,])img\b/.test(selector)) return true
  return classes.some((name) => new RegExp(`\\.${name}(?![\\w-])`).test(selector))
}

const callers = vueFiles(APP).filter(
  (path) => !path.endsWith("ResponsiveImage.vue") && readFileSync(path, "utf8").includes("<ResponsiveImage"),
)

describe("styling a ResponsiveImage", () => {
  it("finds the components that show one", () => {
    expect(callers.length).toBeGreaterThan(5)
  })

  it.each(callers.map((path) => [relative(APP, path), path]))("%s reaches its <img> through :deep()", (_, path) => {
    const source = readFileSync(path, "utf8")
    const classes = imageClasses(source)
    const dead = scopedSelectors(source).filter((selector) => reachesImage(selector, classes))
    expect(dead).toEqual([])
  })
})
