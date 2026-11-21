import { ref } from "vue"
import type { ShopMenuEntry } from "../../shared/utils/menu"

// A shop menu shaped like Fred's (story 12.15c), small enough to read in a
// test: a tab with columns, one of them a heading without a page, a tab with a
// single column, and two tabs without children.

function entry(path: string, label: string, children: ShopMenuEntry[] = []): ShopMenuEntry {
  return { slug: path.split("/").at(-1) ?? "", label, path, kind: "filter", href: path, filter: null, children }
}

function heading(path: string, label: string, children: ShopMenuEntry[]): ShopMenuEntry {
  return { ...entry(path, label, children), kind: "group", href: null }
}

export const SHOP_MENU: ShopMenuEntry[] = [
  entry("/chasse", "Chasse", [
    entry("/chasse/armes-longues", "Armes longues", [
      entry("/chasse/armes-longues/fusils", "Fusils"),
      entry("/chasse/armes-longues/carabines", "Carabines"),
    ]),
    entry("/chasse/optique", "Optique", [entry("/chasse/optique/lunettes", "Lunettes")]),
    heading("/chasse/accessoires", "Accessoires", [
      entry("/chasse/accessoires/nettoyage", "Nettoyage"),
      entry("/chasse/accessoires/appeaux", "Appeaux"),
    ]),
  ]),
  entry("/munitions", "Munitions", [
    entry("/munitions/chasse", "Chasse", [entry("/munitions/chasse/canon-raye", "Canon rayé")]),
  ]),
  entry("/armes-de-defense", "Armes de défense"),
  entry("/coutellerie", "Coutellerie"),
]

/** A `useFetch` stand-in answering the shop menu request, and nothing for the rest. */
export function fetchWithShopMenu(url: string) {
  const body = url.endsWith("/menu") ? { data: SHOP_MENU } : null
  return { data: ref(body), error: ref(null), pending: ref(false) }
}
