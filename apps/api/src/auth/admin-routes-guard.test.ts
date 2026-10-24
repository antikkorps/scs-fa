import { randomUUID } from "node:crypto"
import { USER_ROLES } from "@armurier/shared"
import type { FastifyInstance, InjectOptions } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"

// Inventory guard (story 12.9f): every route under /api/admin, present and
// future, refuses anonymous callers and every role but admin. A new admin
// plugin that forgets `authenticate` + `requireRole("admin")` fails here.

const ADMIN_PREFIX = "/api/admin"
const NON_ADMIN_ROLES = USER_ROLES.filter((role) => role !== "admin")
// HEAD mirrors GET; OPTIONS is the CORS preflight, answered for every path.
const SKIPPED_METHODS = new Set(["HEAD", "OPTIONS"])

type InjectMethod = NonNullable<InjectOptions["method"]>

interface RouteEntry {
  method: InjectMethod
  url: string
}

/**
 * Fastify exposes its routes only as the `printRoutes` tree. Each line is
 * `<indent>├── <segment> (METHOD, …)`, the indent growing by four characters
 * per level, and a child's segment is appended to its parent's path.
 */
function listRoutes(app: FastifyInstance): RouteEntry[] {
  const pathByDepth: string[] = []
  const routes: RouteEntry[] = []
  for (const line of app.printRoutes({ commonPrefix: false }).split("\n")) {
    const match = /^(.*?)[├└]── (\S+)(?: \(([^)]+)\))?$/.exec(line)
    if (!match) continue
    const [, indent = "", segment = "", methodList] = match
    const depth = indent.length / 4
    const path = (pathByDepth[depth - 1] ?? "") + segment
    pathByDepth[depth] = path
    pathByDepth.length = depth + 1
    for (const method of methodList?.split(", ") ?? []) {
      routes.push({ method: method as InjectMethod, url: path })
    }
  }
  return routes
}

/** A concrete URL for a route pattern: every `:param` gets a well-formed UUID. */
function concreteUrl(pattern: string): string {
  return pattern.replace(/:[A-Za-z]+/g, randomUUID()).replace("*", "file")
}

let app: FastifyInstance
let adminRoutes: RouteEntry[]

describe("admin routes refuse non-admins (story 12.9f)", () => {
  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    adminRoutes = listRoutes(app).filter(
      (route) => route.url.startsWith(ADMIN_PREFIX) && !SKIPPED_METHODS.has(route.method),
    )
  })

  afterAll(async () => {
    await app.close()
  })

  it("finds the admin routes to check", () => {
    // Guards the parser: an empty list would make the checks below vacuous.
    expect(adminRoutes.length).toBeGreaterThan(50)
  })

  it("answers 401 without a token", async () => {
    const statuses = await Promise.all(
      adminRoutes.map(async (route) => {
        const res = await app.inject({ method: route.method, url: concreteUrl(route.url) })
        return `${route.method} ${route.url} → ${res.statusCode}`
      }),
    )
    expect(statuses.filter((status) => !status.endsWith("→ 401"))).toEqual([])
  })

  it.each(NON_ADMIN_ROLES)("answers 403 to a %s", async (role) => {
    const token = app.jwt.sign({ sub: randomUUID(), role })
    const statuses = await Promise.all(
      adminRoutes.map(async (route) => {
        const res = await app.inject({
          method: route.method,
          url: concreteUrl(route.url),
          headers: { authorization: `Bearer ${token}` },
        })
        return `${route.method} ${route.url} → ${res.statusCode}`
      }),
    )
    expect(statuses.filter((status) => !status.endsWith("→ 403"))).toEqual([])
  })
})
