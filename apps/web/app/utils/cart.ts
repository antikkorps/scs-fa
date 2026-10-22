import { computePriceTtc } from "@armurier/shared"
import type { CartChange, CartView } from "~/types/cart"
import { formatEuros } from "./format"

type HeldLines = {
  items: Array<Pick<CartView["items"][number], "heldUntil">>
  artworkItems: Array<Pick<CartView["artworkItems"][number], "heldUntil">>
}

/** The first moment an item held in the cart goes back on sale (story 12.9a); null when none is held. */
export function earliestHold(cart: HeldLines): string | null {
  const holds = [...cart.items, ...cart.artworkItems]
    .map((line) => line.heldUntil)
    .filter((heldUntil): heldUntil is string => heldUntil !== null)
  if (holds.length === 0) return null
  return holds.reduce((earliest, heldUntil) => (Date.parse(heldUntil) < Date.parse(earliest) ? heldUntil : earliest))
}

type PricedLines = {
  items: Array<Pick<CartView["items"][number], "id" | "vatPct">>
  artworkItems: Array<Pick<CartView["artworkItems"][number], "id" | "vatPct">>
}

/** One sentence per cart change, prices tax included at the line's own rate (story 12.9d). */
export function cartChangeLabel(change: CartChange, cart: PricedLines): string {
  if (change.kind === "unavailable") return `${change.name} n'est plus disponible : il a été retiré de votre panier.`
  if (change.kind === "category_a") {
    return `${change.name} relève de la catégorie A, vendue aux seuls professionnels sur devis : il a été retiré de votre panier.`
  }
  const line = [...cart.items, ...cart.artworkItems].find((l) => l.id === change.lineId)
  const vatPct = line?.vatPct ?? 0
  const before = formatEuros(computePriceTtc(change.previousPriceHt, vatPct))
  const after = formatEuros(computePriceTtc(change.priceHt, vatPct))
  return `${change.name} : le prix est passé de ${before} à ${after} TTC.`
}
