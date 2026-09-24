import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * sharp 0.35 no longer publishes its types as a namespace beside the default
 * export: `sharp.Sharp` compiles against 0.34 — what main runs — and fails
 * with TS2503 on the Renovate branch. It has broken that PR twice (2026-09-23,
 * then again after story 9.6). Import the type by name instead:
 * `import sharp, { type Sharp } from "sharp"`.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith(".ts") ? [path] : []
  })
}

describe("sharp types", () => {
  it("are never reached through the sharp namespace", () => {
    const offenders = sourceFiles(join(import.meta.dirname, "."))
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .map((line, i) => ({ file, line: i + 1, text: line }))
          // Comments may name the pattern; code may not.
          .filter(({ text }) => !text.trim().startsWith("//") && !text.trim().startsWith("*"))
          .filter(({ text }) => /\bsharp\.[A-Z]\w*/.test(text)),
      )
      .map(({ file, line }) => `${file}:${line}`)
    expect(offenders).toEqual([])
  })
})
