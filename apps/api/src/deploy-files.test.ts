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

// The card form (StripeCardPayment.vue) reads runtimeConfig.public.stripePublishableKey:
// without it in the web container, card payment silently never renders in production.
describe("docker-compose.prod.yml — the front's Stripe publishable key", () => {
  it("is required in .env and handed to the web container", () => {
    expect(serviceBlock(COMPOSE, "web")).toContain(
      "      NUXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: ${STRIPE_PUBLISHABLE_KEY:?set STRIPE_PUBLISHABLE_KEY in .env}",
    )
    expect(read("../../../.env.prod.example")).toMatch(/^STRIPE_PUBLISHABLE_KEY=pk_/m)
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
  for (const name of ["deploy", "up"]) {
    it(`${name} runs env-check first`, () => {
      const commands = recipe(JUSTFILE, name).filter((line) => line.startsWith("{{ compose }}"))
      expect(commands[0]).toMatch(/--profile env-check run --rm (--build )?env-check$/)
    })
  }

  // The update builds images first (nothing touched yet), then checks .env
  // before the backup, the migration and the restart.
  it("update runs env-check before anything touches the database or the running stack", () => {
    const lines = recipe(JUSTFILE, "update")
    const check = lines.findIndex((line) => line.includes("--profile env-check run --rm"))
    const firstTouch = lines.findIndex((line) => /backup\.sh|--profile migrate run|up -d/.test(line))
    expect(check).toBeGreaterThan(-1)
    expect(check).toBeLessThan(firstTouch)
  })
})

describe("justfile — psql-ro, a shell for looking only", () => {
  it("opens the same database as psql, with every transaction read-only", () => {
    const [psql] = recipe(JUSTFILE, "psql")
    const [readOnly] = recipe(JUSTFILE, "psql-ro")
    expect(readOnly).toContain('PGOPTIONS="-c default_transaction_read_only=on"')
    expect(readOnly).toContain(psql?.slice(psql.indexOf("postgres psql")))
  })
})

describe("justfile — migrations", () => {
  it("rebuilds the migrate image before applying, or new migrations never ship", () => {
    const runs = JUSTFILE.split("\n").filter((line) => line.includes("--profile migrate run"))
    expect(runs.length).toBeGreaterThan(0)
    for (const line of runs) expect(line, line.trim()).toContain("--build")
  })
})

// Audit 2026-11-15, M2 + M4: the update refreshed no base image (no security
// fix ever reached Caddy, Postgres or Node), backed nothing up before migrating,
// built after migrating, and left no way back.
describe("justfile — the update procedure", () => {
  const update = () => recipe(JUSTFILE, "update")
  const position = (fragment: string) => update().findIndex((line) => line.includes(fragment))

  it("only fast-forwards: a diverged server checkout stops the update", () => {
    expect(update()[0]).toBe("git pull --ff-only")
  })

  it("keeps the running images as :previous, then refreshes the base images before anything else", () => {
    expect(position("scs-api:latest scs-api:previous")).toBeGreaterThan(-1)
    expect(position("scs-web:latest scs-web:previous")).toBeGreaterThan(-1)
    expect(position("pull --ignore-buildable")).toBeGreaterThan(position("scs-api:previous"))
    expect(position("build --pull")).toBeGreaterThan(position("scs-api:previous"))
  })

  it("builds before migrating, and backs the database up right before the migration", () => {
    const migrate = position("--profile migrate run")
    expect(position("build --pull")).toBeLessThan(migrate)
    expect(position("backup.sh")).toBeGreaterThan(position("build --pull"))
    expect(position("backup.sh")).toBeLessThan(migrate)
  })

  // 2026-11-20: the Caddyfile is a single-file bind mount; `git pull` replaces
  // the file, the running Caddy keeps reading the old one, and `up -d` leaves
  // it alone (same image, same compose config) — a Caddy fix never shipped.
  it("recreates Caddy after the restart when the Caddyfile it reads differs from the checkout", () => {
    const check = position("cat /etc/caddy/Caddyfile")
    expect(check).toBeGreaterThan(position("up -d"))
    expect(update()[check]).toContain("cmp -s - Caddyfile")
    expect(update()[check]).toContain("up -d --force-recreate --no-deps caddy")
  })

  it("offers a way back to the previous images", () => {
    const rollback = recipe(JUSTFILE, "rollback")
    expect(rollback.join("\n")).toContain("scs-api:previous scs-api:latest")
    expect(rollback.join("\n")).toContain("scs-web:previous scs-web:latest")
  })
})

// Audit 2026-11-15, M3: one flat network let ClamAV — a C parser fed hostile
// files — or the front reach Postgres, and gave every container the internet.
describe("docker-compose.prod.yml — network segmentation", () => {
  const networksOf = (service: string) => {
    const line = serviceBlock(COMPOSE, service).find((l) => l.trim().startsWith("networks:")) ?? ""
    return (line.match(/\[(.*)\]/)?.[1] ?? "")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean)
      .sort()
  }

  it("keeps Postgres on a network of its own, with no way out to the internet", () => {
    expect(networksOf("postgres")).toEqual(["data"])
    const data = COMPOSE.split("\n")
    const start = data.indexOf("  data:")
    expect(data.slice(start, start + 4).join("\n")).toContain("internal: true")
  })

  it("lets only what reads the database reach it", () => {
    for (const service of ["api", "migrate", "db-roles", "umami", "backup"]) {
      expect(networksOf(service), service).toContain("data")
    }
    for (const service of ["caddy", "web", "clamav"]) {
      expect(networksOf(service), service).not.toContain("data")
    }
  })

  it("isolates ClamAV with the API alone", () => {
    expect(networksOf("clamav")).toEqual(["scan"])
    expect(networksOf("api")).toContain("scan")
  })
})
