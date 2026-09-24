import type { ProductCategoryRef } from "~/types/product"

// Shared reference data for the armurerie categories, used by the header
// mega-menu and the boutique filters. One SSR-cached request (deduped by key)
// serves every consumer, so we never fetch the list twice on a page.
export function useProductCategories() {
  const request = useApiFetch<{ data: ProductCategoryRef[] }>(`/product-categories`, {
    key: "product-categories",
  })

  const categories = computed(() => request.data.value?.data ?? [])
  // A page that must know the list before rendering (a category page deciding
  // between itself and a 404) awaits this; the header does not.
  const ready = Promise.resolve(request).then(() => undefined)
  return { categories, ready, error: request.error }
}
