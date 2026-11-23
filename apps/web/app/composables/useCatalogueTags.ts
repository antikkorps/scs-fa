import type { Ref } from "vue"
import type { TagFacet, TagFacetGroup } from "~/types/product"

interface CatalogueTagsInput {
  facets: Ref<TagFacetGroup[]>
  /** The page's own tags (a tag page, a menu entry): always applied. */
  pinnedTags: Ref<string[]>
  /** The facets the page leaves out (story 12.15e): neither offered nor read from the address. */
  hiddenFacets: Ref<ReadonlySet<string>>
  /** The `?tags=` value: a comma-separated selection, as the API takes it. */
  queryTags: Ref<string>
}

/**
 * The catalogue's tag filter: what it offers and what the visitor has chosen.
 * Tags of one facet add up (OR): a sibling of a pinned tag would widen the page
 * (« Chasse » showing sport shooting), so their facet holds the pinned tags only.
 */
export function useCatalogueTags({ facets, pinnedTags, hiddenFacets, queryTags }: CatalogueTagsInput) {
  const offered = computed(() => facets.value.filter((group) => !hiddenFacets.value.has(group.facet)))
  const pinnedFacets = computed(
    () =>
      new Set<TagFacet>(
        facets.value
          .filter((group) => group.tags.some((tag) => pinnedTags.value.includes(tag.slug)))
          .map((group) => group.facet),
      ),
  )
  const facetOfTag = computed(
    () => new Map(facets.value.flatMap((group) => group.tags.map((tag) => [tag.slug, group.facet] as const))),
  )
  const refinableFacets = computed(() =>
    offered.value.map((group) =>
      pinnedFacets.value.has(group.facet)
        ? { ...group, tags: group.tags.filter((tag) => pinnedTags.value.includes(tag.slug)) }
        : group,
    ),
  )
  const selectedTags = computed(() =>
    queryTags.value
      .split(",")
      .map((slug) => slug.trim())
      .filter((slug) => {
        const facet = facetOfTag.value.get(slug)
        return slug && !(facet && (pinnedFacets.value.has(facet) || hiddenFacets.value.has(facet)))
      }),
  )
  return { pinnedFacets, facetOfTag, refinableFacets, selectedTags }
}
