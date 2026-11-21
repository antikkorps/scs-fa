import { menuShortcuts, type ShopMenuEntry } from "#shared/utils/menu"

/**
 * The shop menu (story 12.15c): the header draws it, and the links to a
 * category or a tag lead to the menu entry standing for it. One SSR-cached
 * request, deduped by key, serves every consumer on a page.
 */
export function useShopMenu() {
  const request = useApiFetch<{ data: ShopMenuEntry[] }>("/menu", { key: "shop-menu" })
  const menu = computed(() => request.data.value?.data ?? [])
  const shortcuts = computed(() => menuShortcuts(menu.value))
  // A page whose canonical or links depend on the menu awaits this.
  const ready = Promise.resolve(request).then(() => undefined)
  return {
    menu,
    ready,
    categoryPath: (slug: string) => categoryPath(slug, shortcuts.value),
    tagPath: (slug: string) => tagPath(slug, shortcuts.value),
    shortcuts,
  }
}
