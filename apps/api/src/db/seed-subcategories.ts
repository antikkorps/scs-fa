import { db } from "./client.js"
import { productCategories, productSubcategories } from "./schema.js"

// Story 12.15a — the subcategories of Fred's menu (mail of 2026-11-21), by
// category slug. Reference data: idempotent on the slug, so a rename made later
// is never overwritten. FFP, SFP and thermal sights, and the hunting or sport
// use, are tags: they cut across the subcategories.
export const SUBCATEGORIES: Record<string, { slug: string; name: string }[]> = {
  "arme-longue": [
    { slug: "fusils", name: "Fusils" },
    { slug: "carabines", name: "Carabines" },
  ],
  "arme-poing": [
    { slug: "pistolets", name: "Pistolets" },
    { slug: "revolvers", name: "Revolvers" },
  ],
  "aide-visee": [
    { slug: "lunettes-de-visee", name: "Lunettes de visée" },
    { slug: "viseurs-point-rouge", name: "Viseurs point rouge" },
  ],
  munition: [
    { slug: "munitions-canon-raye", name: "Canon rayé" },
    { slug: "munitions-canon-lisse", name: "Canon lisse" },
  ],
  "accessoire-tireur": [
    { slug: "nettoyage", name: "Nettoyage" },
    { slug: "securite-transport", name: "Sécurité & transport" },
  ],
  "accessoire-autre": [{ slug: "appeaux", name: "Appeaux" }],
  coutellerie: [{ slug: "dagues", name: "Dagues" }],
}

export async function seedSubcategories() {
  const categories = await db.select({ id: productCategories.id, slug: productCategories.slug }).from(productCategories)
  const categoryId = new Map(categories.map((c) => [c.slug, c.id]))

  // A category renamed on a server skips its subcategories, loudly, rather than
  // stopping the reference seed (tags come after) halfway.
  const rows = Object.entries(SUBCATEGORIES).flatMap(([categorySlug, subcategories]) => {
    const id = categoryId.get(categorySlug)
    if (!id) {
      console.warn(`⚠️ Subcategories of ${categorySlug} skipped: no such category`)
      return []
    }
    return subcategories.map((sub, index) => ({ ...sub, categoryId: id, displayOrder: index + 1 }))
  })
  if (rows.length === 0) return
  await db.insert(productSubcategories).values(rows).onConflictDoNothing()

  console.log(`✅ Product subcategories seeded (${rows.length})`)
}
