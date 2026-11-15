import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { API_ENV_KEYS } from "./env.js"

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8")
const COMPOSE = read("../../../docker-compose.prod.yml")
const JUSTFILE = read("../../../justfile")

// Variables the API reads outside env.ts: the demo seed (`just seed-demo`).
const READ_OUTSIDE_SCHEMA = ["ADMIN_SEED_EMAIL", "ADMIN_SEED_PASSWORD"]

// Secrets of other services that share the production .env: a code execution in
// the API must not hand over the superuser, the schema owner or the backups.
const FOREIGN_SECRETS = [
  "POSTGRES_PASSWORD",
  "DB_OWNER_PASSWORD",
  "DB_BACKUP_PASSWORD",
  "BACKUP_AGE_RECIPIENT",
  "BACKUP_OBJECTS_PASSWORD",
  "UMAMI_DB_PASSWORD",
  "UMAMI_APP_SECRET",
  "UMAMI_BASIC_AUTH_HASH",
]

/** The lines of one top-level service of the compose file. */
function serviceBlock(compose: string, service: string): string[] {
  const lines = compose.split("\n")
  const start = lines.indexOf(`  ${service}:`)
  if (start === -1) throw new Error(`service ${service} not found`)
  const end = lines.findIndex((line, index) => index > start && /^ {2}[a-z][\w-]*:/.test(line))
  return lines.slice(start + 1, end === -1 ? undefined : end)
}

/** The variable names under the service's `environment:` mapping. */
function environmentKeys(block: string[]): string[] {
  const start = block.findIndex((line) => line.trim() === "environment:")
  if (start === -1) return []
  const keys: string[] = []
  for (const line of block.slice(start + 1)) {
    if (/^ {4}\S/.test(line)) break
    const key = line.match(/^ {6}([A-Z][A-Z0-9_]*):/)?.[1]
    if (key) keys.push(key)
  }
  return keys
}

describe("docker-compose.prod.yml — the API's environment", () => {
  const api = serviceBlock(COMPOSE, "api")

  it("does not load the whole .env", () => {
    expect(api.some((line) => line.trim().startsWith("env_file"))).toBe(false)
  })

  it("lists every variable the API reads, and nothing else", () => {
    const expected = [...API_ENV_KEYS, ...READ_OUTSIDE_SCHEMA].sort()
    expect(environmentKeys(api).sort()).toEqual(expected)
  })

  it("never receives the other services' secrets", () => {
    expect(environmentKeys(api).filter((key) => FOREIGN_SECRETS.includes(key))).toEqual([])
  })
})

describe("docker-compose.prod.yml — the env-check service", () => {
  const check = serviceBlock(COMPOSE, "env-check")

  it("reads the whole .env, offline, and only when asked", () => {
    expect(check).toContain("    env_file: [.env]")
    expect(check).toContain("    network_mode: none")
    expect(check).toContain('    profiles: ["env-check"]')
  })
})

/** The command lines of one justfile recipe. */
function recipe(justfile: string, name: string): string[] {
  const lines = justfile.split("\n")
  const start = lines.findIndex((line) => line.startsWith(`${name}:`))
  if (start === -1) throw new Error(`recipe ${name} not found`)
  const end = lines.findIndex((line, index) => index > start && !line.startsWith("    "))
  return lines.slice(start + 1, end === -1 ? undefined : end).map((line) => line.trim())
}

describe("justfile — the whole .env is checked before anything starts", () => {
  for (const name of ["deploy", "update", "up"]) {
    it(`${name} runs env-check first`, () => {
      const commands = recipe(JUSTFILE, name).filter((line) => line.startsWith("{{ compose }}"))
      expect(commands[0]).toMatch(/--profile env-check run --rm (--build )?env-check$/)
    })
  }
})

describe("justfile — migrations", () => {
  it("rebuilds the migrate image before applying, or new migrations never ship", () => {
    const runs = JUSTFILE.split("\n").filter((line) => line.includes("--profile migrate run"))
    expect(runs.length).toBeGreaterThan(0)
    for (const line of runs) expect(line, line.trim()).toContain("--build")
  })
})
