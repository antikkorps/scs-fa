import { UNIVERSES, type Universe } from "#shared/utils/universes"

/**
 * A universe page's definition, checked against the shop (story 12.13, review
 * of #260): its tag or category must exist — a real 404 otherwise, as on the
 * shop's own category and tag pages — and a universe no product fills yet is
 * kept out of the indexes, an empty grid being a thin page.
 */
export async function useUniverse(path: string): Promise<{ universe: Universe; noindex: boolean }> {
  const universe = UNIVERSES.find((u) => u.path === path)
  if (!universe) throw createError({ statusCode: 404, statusMessage: "Page introuvable", fatal: true })

  if (universe.source.kind === "category") {
    const { categories, ready, error } = useProductCategories()
    await ready
    if (!categories.value.some((c) => c.slug === universe.source.slug)) {
      throw missingPageError(error.value, "Page introuvable")
    }
    return { universe, noindex: false }
  }

  const { facets, ready, error } = useTags()
  await ready
  const tag = facets.value.flatMap((group) => group.tags).find((t) => t.slug === universe.source.slug)
  if (!tag) throw missingPageError(error.value, "Page introuvable")
  return { universe, noindex: tag.productCount === 0 }
}
