import { eq, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { menuEntries, tags } from "../db/schema.js"
import { createAccount, deleteAccounts, type TestAccount } from "../test/account-fixtures.js"

const SUFFIX = "@menu-admin.test"
const BASE = "/api/admin/menu"
// Top-level test entries carry this prefix; their children go with them (cascade).
const PREFIX = "testmenu-"

interface Entry {
  id: string
  parentId: string | null
  slug: string
  label: string
  position: number
  kind: string
  categorySlug: string | null
  subcategorySlug: string | null
  legalCategory: string | null
  tagSlugs: string[]
}

// Story 12.15b — the menu tree, edited from the back-office.
describe("admin menu", () => {
  let app: FastifyInstance
  let admin: TestAccount
  let customer: TestAccount

  const call = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: object) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${admin.token}` }, payload })
  const create = async (payload: object): Promise<Entry> => {
    const res = await call("POST", BASE, payload)
    expect(res.statusCode, res.body).toBe(201)
    return res.json().data
  }
  const top = (name: string, extra: object = {}) => create({ slug: `${PREFIX}${name}`, label: name, ...extra })
  const list = async (): Promise<Entry[]> => (await call("GET", BASE)).json().data

  async function cleanup() {
    await db.delete(menuEntries).where(like(menuEntries.slug, `${PREFIX}%`))
    await db.delete(tags).where(like(tags.slug, `${PREFIX}%`))
    await deleteAccounts(SUFFIX)
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()
    admin = await createAccount(app, SUFFIX, { role: "admin" })
    customer = await createAccount(app, SUFFIX)
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it("is for admins only", async () => {
    const res = await app.inject({ method: "GET", url: BASE, headers: { authorization: `Bearer ${customer.token}` } })
    expect(res.statusCode).toBe(403)
  })

  it("saves an entry's filter and lists it by slugs", async () => {
    const entry = await top("filtre", {
      categorySlug: "munition",
      subcategorySlug: "munitions-canon-raye",
      legalCategory: "C",
      tagSlugs: ["chasse"],
    })
    const listed = (await list()).find((e) => e.id === entry.id)
    expect(listed).toMatchObject({
      parentId: null,
      kind: "filter",
      categorySlug: "munition",
      subcategorySlug: "munitions-canon-raye",
      legalCategory: "C",
      tagSlugs: ["chasse"],
    })
  })

  it.each([
    [{ categorySlug: "inconnue" }, "inconnue"],
    [{ categorySlug: "arme-longue", subcategorySlug: "dagues" }, "dagues"],
    [{ tagSlugs: ["chasse", "inconnu"] }, "inconnu"],
  ])("refuses a filter naming %o", async (filter, culprit) => {
    const res = await call("POST", BASE, { slug: `${PREFIX}ko`, label: "Ko", ...filter })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toContain(culprit)
  })

  it("keeps a tab off the address of a page of the site", async () => {
    const res = await call("POST", BASE, { slug: "panier", label: "Panier" })
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain("/panier")
  })

  // Concurrent moves are queued: each sees the tree the other left.
  it("refuses one of two crossed moves sent at once", async () => {
    const a = await top("croise-a")
    const b = await top("croise-b")
    const results = await Promise.all([
      call("PATCH", `${BASE}/${a.id}`, { parentId: b.id }),
      call("PATCH", `${BASE}/${b.id}`, { parentId: a.id }),
    ])
    expect(results.map((res) => res.statusCode).sort()).toEqual([200, 400])
  })

  it("nests three levels, never four", async () => {
    const one = await top("niveaux")
    const two = await create({ parentId: one.id, slug: "deux", label: "Deux" })
    const three = await create({ parentId: two.id, slug: "trois", label: "Trois" })
    const four = await call("POST", BASE, { parentId: three.id, slug: "quatre", label: "Quatre" })
    expect(four.statusCode).toBe(400)
  })

  it("puts nothing under a link", async () => {
    const link = await top("lien", { kind: "link", linkUrl: "/gun-art" })
    const res = await call("POST", BASE, { parentId: link.id, slug: "enfant", label: "Enfant" })
    expect(res.statusCode).toBe(400)
  })

  it("refuses a slug a sibling has, not one a cousin has", async () => {
    const left = await top("gauche")
    const right = await top("droite")
    await create({ parentId: left.id, slug: "fusils", label: "Fusils" })
    expect((await call("POST", BASE, { parentId: left.id, slug: "fusils", label: "Bis" })).statusCode).toBe(409)
    expect((await call("POST", BASE, { parentId: right.id, slug: "fusils", label: "Fusils" })).statusCode).toBe(201)
    expect((await call("POST", BASE, { slug: `${PREFIX}gauche`, label: "Bis" })).statusCode).toBe(409)
  })

  it("appends a new entry after its siblings", async () => {
    const parent = await top("ordre")
    const first = await create({ parentId: parent.id, slug: "a", label: "A" })
    const second = await create({ parentId: parent.id, slug: "b", label: "B" })
    expect(second.position).toBeGreaterThan(first.position)
  })

  // Story 12.15c — the texts of the entry's page.
  it("saves an entry's page texts and clears them", async () => {
    const entry = await top("textes", { description: "Les carabines.", intro: "Un.\n\nDeux." })
    expect((await list()).find((e) => e.id === entry.id)).toMatchObject({
      description: "Les carabines.",
      intro: "Un.\n\nDeux.",
    })
    const res = await call("PATCH", `${BASE}/${entry.id}`, { description: "" })
    expect(res.json().data).toMatchObject({ description: null, intro: "Un.\n\nDeux." })
  })

  it("renames an entry and replaces its tags", async () => {
    const entry = await top("renomme", { tagSlugs: ["chasse"] })
    const res = await call("PATCH", `${BASE}/${entry.id}`, { label: "Renommée", tagSlugs: ["tir-sportif"] })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ label: "Renommée", tagSlugs: ["tir-sportif"] })
  })

  // The shape is checked once the change is applied, not on the patch alone.
  it("refuses turning a filter with criteria into a group, unless they go too", async () => {
    const entry = await top("forme", { categorySlug: "munition" })
    expect((await call("PATCH", `${BASE}/${entry.id}`, { kind: "group" })).statusCode).toBe(400)
    const res = await call("PATCH", `${BASE}/${entry.id}`, { kind: "group", categorySlug: null })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ kind: "group", categorySlug: null })
  })

  it("drops a subcategory left behind by a new category", async () => {
    const entry = await top("souscat", { categorySlug: "arme-longue", subcategorySlug: "carabines" })
    const res = await call("PATCH", `${BASE}/${entry.id}`, { categorySlug: "munition" })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ categorySlug: "munition", subcategorySlug: null })
  })

  it("moves an entry under another parent, last among its new siblings", async () => {
    const from = await top("depart")
    const to = await top("arrivee")
    await create({ parentId: to.id, slug: "deja-la", label: "Déjà là" })
    const moved = await create({ parentId: from.id, slug: "bouge", label: "Bouge" })
    const res = await call("PATCH", `${BASE}/${moved.id}`, { parentId: to.id })
    expect(res.statusCode).toBe(200)
    const siblings = (await list()).filter((e) => e.parentId === to.id).sort((a, b) => a.position - b.position)
    expect(siblings.map((e) => e.slug)).toEqual(["deja-la", "bouge"])
  })

  it("refuses a move under the entry's own branch, or one that makes a fourth level", async () => {
    const one = await top("cycle")
    const two = await create({ parentId: one.id, slug: "deux", label: "Deux" })
    await create({ parentId: two.id, slug: "trois", label: "Trois" })
    expect((await call("PATCH", `${BASE}/${one.id}`, { parentId: two.id })).statusCode).toBe(400)

    const other = await top("profond")
    const otherChild = await create({ parentId: other.id, slug: "fils", label: "Fils" })
    // `two` brings its child along: under `otherChild` it would reach level four.
    expect((await call("PATCH", `${BASE}/${two.id}`, { parentId: otherChild.id })).statusCode).toBe(400)
  })

  it("reorders the children of one parent", async () => {
    const parent = await top("tri")
    const a = await create({ parentId: parent.id, slug: "a", label: "A" })
    const b = await create({ parentId: parent.id, slug: "b", label: "B" })
    const c = await create({ parentId: parent.id, slug: "c", label: "C" })
    const res = await call("PUT", `${BASE}/order`, { parentId: parent.id, ids: [c.id, a.id, b.id] })
    expect(res.statusCode).toBe(204)
    const siblings = (await list()).filter((e) => e.parentId === parent.id).sort((x, y) => x.position - y.position)
    expect(siblings.map((e) => e.slug)).toEqual(["c", "a", "b"])
  })

  it("refuses an order that leaves out a sibling or brings a stranger", async () => {
    const parent = await top("tri-ko")
    const a = await create({ parentId: parent.id, slug: "a", label: "A" })
    await create({ parentId: parent.id, slug: "b", label: "B" })
    expect((await call("PUT", `${BASE}/order`, { parentId: parent.id, ids: [a.id] })).statusCode).toBe(400)
  })

  it("deletes an entry with its branch", async () => {
    const parent = await top("suppr")
    const child = await create({ parentId: parent.id, slug: "enfant", label: "Enfant" })
    expect((await call("DELETE", `${BASE}/${parent.id}`)).statusCode).toBe(204)
    expect((await list()).some((e) => e.id === child.id)).toBe(false)
    expect((await call("DELETE", `${BASE}/${parent.id}`)).statusCode).toBe(404)
  })

  // A deleted tag would silently widen every entry filtering on it.
  it("refuses deleting a tag a menu entry filters on, naming the entry", async () => {
    const [tag] = await db
      .insert(tags)
      .values({ slug: `${PREFIX}tag`, name: "Tag de test", facet: "usage" })
      .returning({ id: tags.id })
    if (!tag) throw new Error("test tag not inserted")
    const entry = await top("tag-utilise", { tagSlugs: [`${PREFIX}tag`] })
    const tagUrl = `/api/admin/tags/${tag.id}`

    const refused = await call("DELETE", tagUrl)
    expect(refused.statusCode).toBe(409)
    expect(refused.json().message).toContain("tag-utilise")

    await call("PATCH", `${BASE}/${entry.id}`, { tagSlugs: [] })
    expect((await call("DELETE", tagUrl)).statusCode).toBe(204)
    expect(await db.select().from(tags).where(eq(tags.id, tag.id))).toEqual([])
  })
})
