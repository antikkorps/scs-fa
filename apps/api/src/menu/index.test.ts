import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"

interface PublicEntry {
  slug: string
  label: string
  path: string
  kind: string
  href: string | null
  filter: Record<string, unknown> | null
  children: PublicEntry[]
}

const find = (entries: PublicEntry[], path: string): PublicEntry | undefined => {
  for (const entry of entries) {
    if (entry.path === path) return entry
    const found = find(entry.children, path)
    if (found) return found
  }
  return undefined
}

// Story 12.15b — the menu the shop reads, here Fred's initial one (seeded).
describe("GET /api/menu", () => {
  let app: FastifyInstance
  let menu: PublicEntry[]

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    const res = await app.inject({ method: "GET", url: "/api/menu" })
    expect(res.statusCode).toBe(200)
    menu = res.json().data
  })

  afterAll(async () => {
    await app.close()
  })

  it("lists the tabs in their order", () => {
    // Other suites add top-level entries of their own while this one runs.
    const tabs = menu.map((entry) => entry.label).filter((label) => !label.startsWith("test"))
    expect(tabs).toEqual(["Chasse", "Tir sportif", "Munitions", "Armes de défense", "Coutellerie"])
  })

  it("gives each entry its path in the tree and its whole filter", () => {
    expect(find(menu, "/chasse/armes-longues/carabines")).toMatchObject({
      href: "/chasse/armes-longues/carabines",
      filter: { category: "arme-longue", subcategory: "carabines", tags: ["chasse"], legalCategory: null },
    })
    // The same ammunition under two tabs, by two filters (decision of 2026-11-21).
    expect(find(menu, "/chasse/armes-longues/munitions")?.filter).toMatchObject({
      category: "munition",
      tags: ["chasse"],
    })
    expect(find(menu, "/munitions/chasse/canon-raye")?.filter).toMatchObject({
      subcategory: "munitions-canon-raye",
      tags: ["chasse"],
    })
    expect(find(menu, "/tir-sportif/armes-longues/categorie-b")?.filter).toMatchObject({ legalCategory: "B" })
  })

  it("gives a heading no page of its own", () => {
    expect(find(menu, "/chasse/accessoires")).toMatchObject({ kind: "group", href: null, filter: null })
    expect(find(menu, "/chasse/accessoires")?.children.map((entry) => entry.slug)).toEqual([
      "nettoyage",
      "securite-transport",
      "appeaux",
    ])
  })

  it("never shows the entries' internal ids", () => {
    expect(JSON.stringify(menu)).not.toMatch(/"(id|parentId)"/)
  })
})

// Story 12.15c — what an entry's page needs, by its address.
describe("GET /api/menu/page", () => {
  let app: FastifyInstance
  const page = (path: string) => app.inject({ method: "GET", url: `/api/menu/page?path=${encodeURIComponent(path)}` })

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it("gives the entry, its filter, its trail and its sub-entries", async () => {
    const res = await page("/chasse/armes-longues")
    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data).toMatchObject({
      label: "Armes longues",
      path: "/chasse/armes-longues",
      filter: { category: "arme-longue", subcategory: null, tags: ["chasse"], legalCategory: null },
      breadcrumb: [{ label: "Chasse", href: "/chasse" }],
    })
    expect(data.children.map((child: { label: string }) => child.label)).toEqual(["Fusils", "Carabines", "Munitions"])
  })

  it("names a heading in the trail without a link", async () => {
    const data = (await page("/chasse/accessoires/nettoyage")).json().data
    expect(data.breadcrumb).toEqual([
      { label: "Chasse", href: "/chasse" },
      { label: "Accessoires", href: null },
    ])
  })

  // The seeded tabs keep the texts of the universe pages they replace.
  it("gives a tab its page texts", async () => {
    const data = (await page("/coutellerie")).json().data
    expect(data.description).toMatch(/majeures/)
    expect(data.intro).toMatch(/18 ans/)
  })

  it.each(["/chasse/inconnue", "/chasse/accessoires", "/", "/chasse//armes-longues"])(
    "has no page at %s",
    async (path) => {
      expect((await page(path)).statusCode).toBe(404)
    },
  )

  it("keeps the texts out of the tree the header reads", async () => {
    const res = await app.inject({ method: "GET", url: "/api/menu" })
    expect(res.body).not.toMatch(/"(intro|description)"/)
  })
})
