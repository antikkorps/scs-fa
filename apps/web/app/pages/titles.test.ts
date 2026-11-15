import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

// SEO audit 2026-11-15, finding 9: app.vue's titleTemplate appends
// « — SCS Firearms » to every page title, so a title that already says it
// reads « Connexion — SCS Firearms — SCS Firearms » in the tab and history.
// (socialTitle is not templated: it carries the brand on purpose.)
const PAGES = fileURLToPath(new URL(".", import.meta.url))

function vueFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return vueFiles(path)
    return name.endsWith(".vue") ? [path] : []
  })
}

describe("page titles", () => {
  it("never repeat the brand the title template adds", () => {
    const offenders = vueFiles(PAGES).filter((file) =>
      // useHead / useSeoMeta / usePageSeo titles, a plain string or a getter;
      // not a link's title attribute (the RSS link sits deeper, in `link: [...]`).
      /(?:useHead|useSeoMeta)\(\{\s*title:[^\n]*SCS Firearms|^ {2}title:.*SCS Firearms/m.test(
        readFileSync(file, "utf8"),
      ),
    )
    expect(offenders.map((file) => file.slice(PAGES.length))).toEqual([])
  })
})
