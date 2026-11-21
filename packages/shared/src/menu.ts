// Story 12.15b — the shop menu, a tree of saved filters edited from the back-office.

import { LEGAL_CATEGORIES, MAX_TAG_FILTERS } from "./constants.js"
import { categorySlugSchema, tagSlugSchema, toPatchSchema } from "./validation.js"
import { z } from "./zod.js"

export const MENU_ENTRY_KINDS = ["filter", "group", "link"] as const
export type MenuEntryKind = (typeof MENU_ENTRY_KINDS)[number]

/** Three levels in the menu; a fourth would be the page's own filters (decision D3). */
export const MENU_MAX_DEPTH = 3

/**
 * A tab's address is /<slug>: these are the site's own top-level pages (and
 * the API), which a tab would hide or be hidden by. Kept in step with
 * apps/web/app/pages by a test there. /chasse and /coutellerie are not in it:
 * their menu pages replace them (story 12.15c).
 */
export const RESERVED_MENU_SLUGS = [
  "admin",
  "api",
  "armes-de-collection",
  "blog",
  "boutique",
  "cgv",
  "collection",
  "commande",
  "compte",
  "compte-supprime",
  "confidentialite",
  "connexion",
  "contact",
  "gun-art",
  "inscription",
  "mentions-legales",
  "mot-de-passe-oublie",
  "newsletter",
  "panier",
  "pro",
  "recherche",
  "reglementation",
  "reset-password",
] as const

const menuSlugSchema = z
  .string()
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Invalid menu slug")

// A path on this site only: the staff edit the menu and every visitor sees it,
// so an entry never leads off the site (`//host` is another site) nor runs a script.
const menuLinkUrlSchema = z
  .string()
  .trim()
  .max(500)
  .regex(/^\/(?!\/)[^\s\\]*$/, "Must be a path on this site")

/** The longest description a search result shows in full. */
export const MENU_DESCRIPTION_MAX = 160
export const MENU_INTRO_MAX = 3000

// Optional page text: blank means none, so a cleared field reads back as null.
const menuPageText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((text) => text || null)
    .nullable()
    .default(null)

const menuEntryFields = z.object({
  parentId: z.string().uuid().nullable().default(null),
  slug: menuSlugSchema,
  label: z.string().trim().min(1).max(100),
  kind: z.enum(MENU_ENTRY_KINDS).default("filter"),
  linkUrl: menuLinkUrlSchema.nullable().default(null),
  categorySlug: categorySlugSchema.nullable().default(null),
  subcategorySlug: categorySlugSchema.nullable().default(null),
  legalCategory: z.enum(LEGAL_CATEGORIES).nullable().default(null),
  tagSlugs: z
    .array(tagSlugSchema)
    .max(MAX_TAG_FILTERS)
    .transform((slugs) => [...new Set(slugs)])
    .default([]),
  // Story 12.15c — the entry's page: its meta description and its introduction
  // (plain paragraphs separated by a blank line).
  description: menuPageText(MENU_DESCRIPTION_MAX),
  intro: menuPageText(MENU_INTRO_MAX),
})

export type MenuEntryShape = Pick<
  z.infer<typeof menuEntryFields>,
  "parentId" | "slug" | "kind" | "linkUrl" | "categorySlug" | "subcategorySlug" | "legalCategory" | "tagSlugs"
>

/**
 * What is wrong with an entry's shape, or null. Shared by the create schema and
 * the PATCH route, which checks the entry as it will be once the change is applied.
 */
export function menuEntryShapeIssue(entry: MenuEntryShape): string | null {
  if (entry.parentId === null && (RESERVED_MENU_SLUGS as readonly string[]).includes(entry.slug)) {
    return `The address /${entry.slug} is reserved for a page of the site`
  }
  if ((entry.kind === "link") !== (entry.linkUrl !== null)) return "A link entry needs an address, and only a link"
  const hasCriteria =
    entry.categorySlug !== null ||
    entry.subcategorySlug !== null ||
    entry.legalCategory !== null ||
    entry.tagSlugs.length > 0
  if (entry.kind !== "filter" && hasCriteria) return "Only a filter entry takes criteria"
  if (entry.subcategorySlug !== null && entry.categorySlug === null) return "A subcategory needs its category"
  return null
}

function refineShape(entry: MenuEntryShape, ctx: z.RefinementCtx) {
  const issue = menuEntryShapeIssue(entry)
  if (issue) ctx.addIssue({ code: "custom", message: issue })
}

export const createMenuEntrySchema = menuEntryFields.superRefine(refineShape)
export type CreateMenuEntryInput = z.infer<typeof createMenuEntrySchema>

/** A moved entry (new parentId) goes last among its new siblings. */
export const updateMenuEntrySchema = toPatchSchema(menuEntryFields).refine((patch) => Object.keys(patch).length > 0, {
  message: "At least one field must be provided",
})
export type UpdateMenuEntryInput = z.infer<typeof updateMenuEntrySchema>

/** The children of one parent, in their new order. */
export const reorderMenuSchema = z.object({
  parentId: z.string().uuid().nullable(),
  ids: z
    .array(z.string().uuid())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, { message: "Duplicate id" }),
})
export type ReorderMenuInput = z.infer<typeof reorderMenuSchema>
