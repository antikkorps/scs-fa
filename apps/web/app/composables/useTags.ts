import type { TagFacet, TagFacetGroup } from "~/types/product"

// French labels for the facets. The facet codes are structural (they live in a
// DB enum and drive the query); only their wording belongs to the front.
const FACET_LABELS: Record<TagFacet, string> = {
  etat: "État",
  epoque: "Époque",
  caracteristique: "Caractéristiques",
}

export function tagFacetLabel(facet: TagFacet): string {
  return FACET_LABELS[facet] ?? facet
}

/**
 * Reference data for the tag filter panel: every tag grouped by facet, with the
 * number of catalogue products it matches. One SSR-cached request (deduped by
 * key) serves every consumer.
 *
 * Empty facets are dropped here rather than server-side: the API returns them so
 * the contract stays stable, but a filter panel shouldn't render a heading with
 * nothing under it.
 */
export function useTags() {
  const config = useRuntimeConfig()
  const apiBase = config.public.apiBase as string

  const { data } = useFetch<{ data: TagFacetGroup[] }>(`${apiBase}/tags`, {
    key: "tags",
    default: () => ({ data: [] }),
  })

  const facets = computed(() => (data.value?.data ?? []).filter((group) => group.tags.length > 0))

  return { facets, tagFacetLabel }
}
