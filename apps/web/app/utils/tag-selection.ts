/**
 * The selection once `slug` is picked in a single-choice facet: the facet's
 * previous choice goes, the other facets' tags stay. An empty slug picks none.
 */
export function pickInFacet(
  selected: string[],
  facetOfTag: ReadonlyMap<string, string>,
  facet: string,
  slug: string,
): string[] {
  const others = selected.filter((tag) => facetOfTag.get(tag) !== facet)
  return slug ? [...others, slug] : others
}
