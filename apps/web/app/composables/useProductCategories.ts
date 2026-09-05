import type { ProductCategoryRef } from "~/types/product"

// Shared reference data for the armurerie categories, used by the header
// mega-menu and the boutique filters. One SSR-cached request (deduped by key)
// serves every consumer, so we never fetch the list twice on a page.
export function useProductCategories() {
  const config = useRuntimeConfig()
  const apiBase = config.public.apiBase as string

  const { data } = useFetch<{ data: ProductCategoryRef[] }>(`${apiBase}/product-categories`, {
    key: "product-categories",
    default: () => ({ data: [] }),
  })

  const categories = computed(() => data.value?.data ?? [])
  return { categories }
}
