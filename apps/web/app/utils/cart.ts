import type { CartView } from "~/types/cart"

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
