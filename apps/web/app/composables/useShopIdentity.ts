import { EMPTY_SHOP_IDENTITY, type ShopIdentity } from "@armurier/shared"

// Audit 2026-11-01 (I8) — the shop's identity, entered in the back-office: the
// legal pages state its facts, /contact shows how to reach the shop. A page
// awaits loadShopIdentity() once (server side); its components then read the
// same state with useShopIdentity(), without fetching it again.

const KEY = "shop-identity"

/** The identity in this request's state — empty (placeholders) until loaded. */
export function useShopIdentity(): ComputedRef<ShopIdentity> {
  const state = useState<ShopIdentity | null>(KEY, () => null)
  return computed(() => state.value ?? EMPTY_SHOP_IDENTITY)
}

/** Fetch the identity once per request; an unreachable API leaves the placeholders. */
export async function loadShopIdentity(): Promise<ComputedRef<ShopIdentity>> {
  // Every composable BEFORE the await: Nuxt loses its context after it (a
  // useState there threw "called outside of a Vue setup function" — a 500).
  const state = useState<ShopIdentity | null>(KEY, () => null)
  const identity = computed(() => state.value ?? EMPTY_SHOP_IDENTITY)
  if (!state.value) {
    const { data } = await useApiFetch<{ data: ShopIdentity }>("/shop-identity", { key: KEY })
    state.value = data.value?.data ?? null
  }
  return identity
}
