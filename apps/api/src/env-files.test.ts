import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

// The production `.env` (copied from .env.prod.example) is read by three
// parsers: Docker Compose (interpolation and env_file) and `just` (`set
// dotenv-load`, for recipes such as `just restore`). `just`'s parser rejects an
// unquoted value containing whitespace and then refuses to run any recipe;
// quoted values suit all three.
const PRODUCTION_EXAMPLE = "../../../.env.prod.example"

function unquotedValuesWithWhitespace(content: string): string[] {
  return content
    .split("\n")
    .filter((line) => /^[A-Z0-9_]+=/.test(line))
    .filter((line) => {
      const value = line.slice(line.indexOf("=") + 1)
      const quoted = /^(".*"|'.*')$/.test(value)
      return !quoted && /\s/.test(value)
    })
    .map((line) => line.slice(0, line.indexOf("=")))
}

describe(".env.prod.example", () => {
  it("quotes every value that contains whitespace", () => {
    const path = fileURLToPath(new URL(PRODUCTION_EXAMPLE, import.meta.url))
    expect(unquotedValuesWithWhitespace(readFileSync(path, "utf8"))).toEqual([])
  })
})
