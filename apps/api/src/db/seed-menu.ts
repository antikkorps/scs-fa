import type { LegalCategory, MenuEntryKind } from "@armurier/shared"
import { filterColumns, MenuInputError, setEntryTags } from "../menu/entries.js"
import { type DbExecutor, db } from "./client.js"
import { menuEntries } from "./schema.js"

interface SeedEntry {
  slug: string
  label: string
  kind?: MenuEntryKind
  category?: string
  subcategory?: string
  legal?: LegalCategory
  tags?: string[]
  description?: string
  intro?: string
  children?: SeedEntry[]
}

const HUNTING = ["chasse"]
const SPORT = ["tir-sportif"]

const ammunitionBy = (tags: string[]): SeedEntry[] => [
  { slug: "canon-raye", label: "Canon rayé", category: "munition", subcategory: "munitions-canon-raye", tags },
  { slug: "canon-lisse", label: "Canon lisse", category: "munition", subcategory: "munitions-canon-lisse", tags },
]

// Story 12.15c — the texts of the universe pages these two tabs replace (12.13),
// first drafts still to be read by Fred.
const HUNTING_PAGE = {
  description:
    "Carabines et fusils de chasse, munitions, optiques, couteaux et équipement du chasseur. Prix TTC et stock en temps réel.",
  intro:
    "Carabines et fusils de chasse, munitions, optiques, couteaux et équipement du chasseur : tout ce qu'il faut pour la saison, choisi par notre armurerie.\n\nChaque arme indique sa catégorie légale et les pièces exigées : pour une arme de catégorie C, un permis de chasser validé ou une licence de tir, avec une pièce d'identité.",
}
const KNIVES_PAGE = {
  description:
    "La coutellerie SCS Firearms : couteaux pliants, à lame fixe et de chasse, des meilleures marques. Vente réservée aux personnes majeures.",
  intro:
    "Couteaux pliants, à lame fixe et de chasse : une sélection de lames pour l'usage comme pour la collection.\n\nVente réservée aux personnes de 18 ans et plus : vous le certifiez sur l'honneur à la commande. Le port d'un couteau sans motif légitime est interdit.",
}

// Story 12.15b — Fred's menu (mail of 2026-11-21), the initial content of the
// tree he then edits from the back-office. The tabs run from the best seller to
// the rarest; Armes de collection and Gun Art stand apart, outside this tree.
// The accessories are a heading: their entries span two categories.
export const INITIAL_MENU: SeedEntry[] = [
  {
    slug: "chasse",
    label: "Chasse",
    tags: HUNTING,
    ...HUNTING_PAGE,
    children: [
      {
        slug: "armes-longues",
        label: "Armes longues",
        category: "arme-longue",
        tags: HUNTING,
        children: [
          { slug: "fusils", label: "Fusils", category: "arme-longue", subcategory: "fusils", tags: HUNTING },
          { slug: "carabines", label: "Carabines", category: "arme-longue", subcategory: "carabines", tags: HUNTING },
          { slug: "munitions", label: "Munitions", category: "munition", tags: HUNTING },
        ],
      },
      {
        slug: "optique",
        label: "Optique",
        category: "aide-visee",
        tags: HUNTING,
        children: [
          {
            slug: "lunettes",
            label: "Lunettes",
            category: "aide-visee",
            subcategory: "lunettes-de-visee",
            tags: HUNTING,
          },
          {
            slug: "point-rouge",
            label: "Point rouge",
            category: "aide-visee",
            subcategory: "viseurs-point-rouge",
            tags: HUNTING,
          },
        ],
      },
      {
        slug: "couteaux-de-chasse",
        label: "Couteaux de chasse",
        category: "coutellerie",
        tags: HUNTING,
        children: [{ slug: "dagues", label: "Dagues", category: "coutellerie", subcategory: "dagues" }],
      },
      {
        slug: "accessoires",
        label: "Accessoires",
        kind: "group",
        children: [
          { slug: "nettoyage", label: "Nettoyage", category: "accessoire-tireur", subcategory: "nettoyage" },
          {
            slug: "securite-transport",
            label: "Sécurité & transport",
            category: "accessoire-tireur",
            subcategory: "securite-transport",
          },
          { slug: "appeaux", label: "Appeaux", category: "accessoire-autre", subcategory: "appeaux" },
        ],
      },
    ],
  },
  {
    slug: "tir-sportif",
    label: "Tir sportif",
    tags: SPORT,
    children: [
      {
        slug: "armes-longues",
        label: "Armes longues",
        category: "arme-longue",
        tags: SPORT,
        children: [
          { slug: "categorie-c", label: "Catégorie C", category: "arme-longue", legal: "C", tags: SPORT },
          { slug: "categorie-b", label: "Catégorie B", category: "arme-longue", legal: "B", tags: SPORT },
        ],
      },
      {
        slug: "armes-de-poing",
        label: "Armes de poing",
        category: "arme-poing",
        tags: SPORT,
        children: [
          { slug: "revolvers", label: "Revolvers", category: "arme-poing", subcategory: "revolvers", tags: SPORT },
          { slug: "pistolets", label: "Pistolets", category: "arme-poing", subcategory: "pistolets", tags: SPORT },
        ],
      },
      {
        slug: "optique",
        label: "Optique",
        category: "aide-visee",
        tags: SPORT,
        // FFP, SFP and thermal: the fourth level, the page's own filters (D3).
        children: [
          {
            slug: "lunettes",
            label: "Lunettes",
            category: "aide-visee",
            subcategory: "lunettes-de-visee",
            tags: SPORT,
          },
          {
            slug: "viseurs-point-rouge",
            label: "Viseurs point rouge",
            category: "aide-visee",
            subcategory: "viseurs-point-rouge",
            tags: SPORT,
          },
        ],
      },
    ],
  },
  {
    slug: "munitions",
    label: "Munitions",
    category: "munition",
    children: [
      { slug: "chasse", label: "Chasse", category: "munition", tags: HUNTING, children: ammunitionBy(HUNTING) },
      { slug: "tir-sportif", label: "Tir sportif", category: "munition", tags: SPORT, children: ammunitionBy(SPORT) },
    ],
  },
  { slug: "armes-de-defense", label: "Armes de défense", category: "arme-defense" },
  { slug: "coutellerie", label: "Coutellerie", category: "coutellerie", ...KNIVES_PAGE },
]

async function insertEntry(entry: SeedEntry, parentId: string | null, position: number, tx: DbExecutor) {
  const columns = await filterColumns(
    {
      categorySlug: entry.category ?? null,
      subcategorySlug: entry.subcategory ?? null,
      legalCategory: entry.legal ?? null,
    },
    tx,
  )
  const [row] = await tx
    .insert(menuEntries)
    .values({
      parentId,
      slug: entry.slug,
      label: entry.label,
      kind: entry.kind,
      description: entry.description,
      intro: entry.intro,
      position,
      ...columns,
    })
    .returning({ id: menuEntries.id })
  if (!row) throw new Error(`Menu entry ${entry.slug} not inserted`)
  await setEntryTags(row.id, entry.tags ?? [], tx)
  return row.id
}

/**
 * Lays the entries and their branches; returns how many. An entry naming a
 * category or tag the server lacks (renamed there) is skipped with its branch,
 * loudly, and the rest of the menu still goes in.
 */
export async function insertEntries(entries: SeedEntry[], parentId: string | null, tx: DbExecutor): Promise<number> {
  let count = 0
  for (const [index, entry] of entries.entries()) {
    try {
      // A savepoint: a refused entry leaves no half-written row behind.
      const id = await tx.transaction((savepoint) => insertEntry(entry, parentId, index + 1, savepoint))
      count += 1 + (await insertEntries(entry.children ?? [], id, tx))
    } catch (error) {
      if (!(error instanceof MenuInputError)) throw error
      console.warn(`⚠️ Menu entry ${entry.slug} skipped, with its branch: ${error.message}`)
    }
  }
  return count
}

/**
 * Lays the initial menu on a server that has none. Never touches a menu
 * already there: from then on it is Fred's, edited from the back-office.
 */
export async function seedMenu() {
  const [existing] = await db.select({ id: menuEntries.id }).from(menuEntries).limit(1)
  if (existing) {
    console.log("✅ Shop menu already set: left as it is")
    return
  }
  const count = await db.transaction((tx) => insertEntries(INITIAL_MENU, null, tx))
  console.log(`✅ Shop menu seeded (${count} entries)`)
}
