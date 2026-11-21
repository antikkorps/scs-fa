import { describe, expect, it } from "vitest"
import {
  createMenuEntrySchema,
  menuEntryShapeIssue,
  RESERVED_MENU_SLUGS,
  reorderMenuSchema,
  updateMenuEntrySchema,
} from "./menu.js"

const filter = { slug: "carabines", label: "Carabines", categorySlug: "arme-longue", subcategorySlug: "carabines" }

describe("createMenuEntrySchema (story 12.15b)", () => {
  it("defaults to a top-level filter entry without criteria beyond the given ones", () => {
    expect(createMenuEntrySchema.parse(filter)).toMatchObject({
      parentId: null,
      kind: "filter",
      linkUrl: null,
      legalCategory: null,
      tagSlugs: [],
    })
  })

  it("takes a link to a page of the site", () => {
    const parsed = createMenuEntrySchema.safeParse({
      slug: "journal",
      label: "Journal",
      kind: "link",
      linkUrl: "/blog",
    })
    expect(parsed.success).toBe(true)
  })

  // An entry is edited by the shop's staff and shown to every visitor: it never
  // sends them off the site, nor runs a script.
  it.each(["https://evil.example", "//evil.example", "javascript:alert(1)", "/a b"])("refuses the link %s", (url) => {
    expect(createMenuEntrySchema.safeParse({ slug: "x", label: "X", kind: "link", linkUrl: url }).success).toBe(false)
  })

  it("refuses a slug that is not one URL segment", () => {
    expect(createMenuEntrySchema.safeParse({ ...filter, slug: "armes/longues" }).success).toBe(false)
  })
})

describe("menuEntryShapeIssue", () => {
  const entry = {
    parentId: null as string | null,
    slug: "rayon",
    kind: "filter" as const,
    linkUrl: null,
    categorySlug: null,
    subcategorySlug: null,
    legalCategory: null,
    tagSlugs: [] as string[],
  }

  it("accepts a filter, a group and a link of the right shape", () => {
    expect(menuEntryShapeIssue({ ...entry, categorySlug: "munition", tagSlugs: ["chasse"] })).toBeNull()
    expect(menuEntryShapeIssue({ ...entry, kind: "group" })).toBeNull()
    expect(menuEntryShapeIssue({ ...entry, kind: "link", linkUrl: "/collection" })).toBeNull()
  })

  it("asks a link for its address, and only a link", () => {
    expect(menuEntryShapeIssue({ ...entry, kind: "link" })).toMatch(/address/)
    expect(menuEntryShapeIssue({ ...entry, linkUrl: "/collection" })).toMatch(/address/)
  })

  it("keeps criteria off a group and a link", () => {
    expect(menuEntryShapeIssue({ ...entry, kind: "group", tagSlugs: ["chasse"] })).toMatch(/criteria/)
    expect(menuEntryShapeIssue({ ...entry, kind: "link", linkUrl: "/x", categorySlug: "munition" })).toMatch(/criteria/)
  })

  // A tab's address is /<slug>: it must not take a page the site already has.
  it("keeps the site's own pages off the tabs, not off the sub-entries", () => {
    expect(RESERVED_MENU_SLUGS).toContain("panier")
    expect(menuEntryShapeIssue({ ...entry, kind: "group", slug: "panier" })).toMatch(/reserved/)
    expect(menuEntryShapeIssue({ ...entry, kind: "group", slug: "panier", parentId: "p" })).toBeNull()
  })

  it("refuses a subcategory without its category", () => {
    expect(menuEntryShapeIssue({ ...entry, subcategorySlug: "carabines" })).toMatch(/category/)
  })
})

describe("updateMenuEntrySchema", () => {
  it("takes a partial change, never an empty one", () => {
    expect(updateMenuEntrySchema.parse({ label: "Fusils de chasse" })).toEqual({ label: "Fusils de chasse" })
    expect(updateMenuEntrySchema.safeParse({}).success).toBe(false)
  })
})

describe("reorderMenuSchema", () => {
  it("takes the siblings' ids in their new order, without duplicates", () => {
    const id = "6f1c3a52-6f0e-4a8e-9d55-1b2f3c4d5e6f"
    const other = "7a2d4b63-7a1f-4b9f-8e66-2c3a4d5e6f70"
    expect(reorderMenuSchema.safeParse({ parentId: null, ids: [id, other] }).success).toBe(true)
    expect(reorderMenuSchema.safeParse({ parentId: null, ids: [id, id] }).success).toBe(false)
  })
})

// Story 12.15c — the texts of an entry's page, both optional.
describe("an entry's page texts", () => {
  const base = { slug: "carabines", label: "Carabines" }

  it("keeps a description and an introduction, trimmed", () => {
    const parsed = createMenuEntrySchema.parse({
      ...base,
      description: "  Carabines de chasse. ",
      intro: "Un.\n\nDeux.",
    })
    expect(parsed).toMatchObject({ description: "Carabines de chasse.", intro: "Un.\n\nDeux." })
  })

  it("stores a blank text as none", () => {
    expect(createMenuEntrySchema.parse({ ...base, description: "   " }).description).toBeNull()
    expect(createMenuEntrySchema.parse(base)).toMatchObject({ description: null, intro: null })
    expect(updateMenuEntrySchema.parse({ intro: "" })).toEqual({ intro: null })
  })

  // A search result shows about 160 characters of the description.
  it("caps the description at a search snippet's length", () => {
    expect(createMenuEntrySchema.safeParse({ ...base, description: "x".repeat(161) }).success).toBe(false)
    expect(createMenuEntrySchema.safeParse({ ...base, intro: "x".repeat(3001) }).success).toBe(false)
  })
})
