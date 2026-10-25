<script setup lang="ts">
import { CURRENT_TERMS_VERSION, isDeliverableAddress } from "@armurier/shared"
import type { CartChange, CartView } from "~/types/cart"
import type { Address } from "~/types/checkout"
import { cartChangeLabel, earliestHold } from "~/utils/cart"
import { formatDate, formatEuros } from "~/utils/format"
import { addressLine, UNDELIVERABLE_MESSAGE } from "~/utils/order"

definePageMeta({ middleware: "auth" })
useHead({ title: "Commande — SCS Firearms" })

const { fetchCart, count: cartCount } = useCart()
const { list: listAddresses } = useAddresses()
const { create: createOrder } = useOrders()
const router = useRouter()

const cart = ref<CartView | null>(null)
const addresses = ref<Address[]>([])
const pending = ref(true)
const loadError = ref(false)

const shippingId = ref<string>("")
const billingDifferent = ref(false)
const billingId = ref<string>("")

// CGV acceptance (story 12.1): explicit, never pre-ticked, and the version
// shown here is the one sent — and stored — with the order.
const termsAccepted = ref(false)
const termsVersionLabel = formatDate(CURRENT_TERMS_VERSION)

const placing = ref(false)
const placeError = ref("")
const cartChanges = ref<string[]>([])

// Story 12.9a — held items go back on sale when their time runs out, checkout or not.
const holdEndsAt = computed(() => (cart.value ? earliestHold(cart.value) : null))
const holdNotice = ref("")
async function onHoldExpired() {
  holdNotice.value = "Le délai de réservation d'un article est écoulé : vérifiez votre panier avant de commander."
  cart.value = await fetchCart()
}

const cartEmpty = computed(() => !pending.value && (cart.value?.summary.itemCount ?? 0) === 0)

async function load() {
  pending.value = true
  loadError.value = false
  try {
    const [c, a] = await Promise.all([fetchCart(), listAddresses()])
    cart.value = c
    addresses.value = a
    const def = a.find((x) => x.isDefault) ?? a[0]
    if (def) shippingId.value = def.id
  } catch {
    loadError.value = true
  } finally {
    pending.value = false
  }
}
onMounted(load)

/** A new address was added in the picker: the book is read again (billing lists it too). */
async function reloadAddresses() {
  addresses.value = await listAddresses()
}

const shippingAddress = computed(() => addresses.value.find((a) => a.id === shippingId.value) ?? null)
const shippingUndeliverable = computed(
  () => shippingAddress.value !== null && !isDeliverableAddress(shippingAddress.value),
)

async function placeOrder() {
  placeError.value = ""
  cartChanges.value = []
  if (!shippingId.value) {
    placeError.value = "Choisissez une adresse de livraison."
    return
  }
  if (shippingUndeliverable.value) {
    placeError.value = UNDELIVERABLE_MESSAGE
    return
  }
  if (!termsAccepted.value) {
    placeError.value = "Acceptez les conditions générales de vente pour commander."
    return
  }
  placing.value = true
  try {
    const billing = billingDifferent.value && billingId.value ? billingId.value : undefined
    const order = await createOrder({
      shippingAddressId: shippingId.value,
      ...(billing ? { billingAddressId: billing } : {}),
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
    })
    // The order consumes the cart server-side — clear the header badge.
    cartCount.value = 0
    await router.push(`/commande/${order.id}`)
  } catch (err) {
    const status = authErrorStatus(err)
    // Story 12.9d: a price moved or an article left the catalogue since the cart
    // was filled. The API sends the refreshed cart: show it, and what changed.
    const refreshed = apiErrorField<CartView>(err, "cart")
    if (status === 409 && apiErrorCode(err) === "CartChanged" && refreshed) {
      cart.value = refreshed
      cartCount.value = refreshed.summary.itemCount
      cartChanges.value = (apiErrorField<CartChange[]>(err, "changes") ?? []).map((change) =>
        cartChangeLabel(change, refreshed),
      )
      placeError.value = "Votre panier a changé depuis son remplissage : vérifiez-le, puis confirmez la commande."
      placing.value = false
      return
    }
    placeError.value =
      status === 409 && apiErrorCode(err) === "TermsOutdated"
        ? "Nos conditions générales de vente ont changé depuis l'ouverture de cette page. Rechargez la page pour lire la nouvelle version."
        : status === 422 && apiErrorCode(err) === "UndeliverableAddress"
          ? UNDELIVERABLE_MESSAGE
          : status === 400
            ? "Votre panier est vide ou invalide."
            : "Impossible de créer la commande."
    placing.value = false
  }
}
</script>

<template>
  <div class="checkout">
    <section class="container">
      <h1 class="checkout__title">Commande</h1>

      <p v-if="pending" class="state">Chargement…</p>
      <p v-else-if="loadError" class="state">Impossible de charger la commande. Réessayez.</p>
      <p v-else-if="cartEmpty" class="state">
        Votre panier est vide. <NuxtLink to="/boutique" class="link">Voir la boutique</NuxtLink>.
      </p>

      <div v-else-if="cart" class="checkout__grid">
        <div class="checkout__main">
          <section aria-labelledby="addr-h">
            <h2 id="addr-h" class="section__h">Adresse de livraison</h2>
            <ShippingAddressPicker v-model="shippingId" :addresses="addresses" @created="reloadAddresses" />

            <label class="billing-toggle">
              <input v-model="billingDifferent" type="checkbox" />
              <span>Adresse de facturation différente</span>
            </label>
            <ul v-if="billingDifferent && addresses.length > 0" class="addr-list" role="list">
              <li v-for="a in addresses" :key="a.id">
                <label class="addr">
                  <input v-model="billingId" type="radio" name="billing" :value="a.id" />
                  <span>{{ addressLine(a) }}</span>
                </label>
              </li>
            </ul>
          </section>

          <p class="split-note">
            Selon les articles, le paiement peut être réparti : les <strong>armes réglementées (cat. A/B/C)</strong> se
            règlent par <strong>virement</strong> ; le reste (cat. D, vente libre, Gun Art) par carte. Le détail
            s'affiche à l'étape suivante.
          </p>
        </div>

        <aside class="summary">
          <h2 class="section__h">Récapitulatif</h2>
          <CartHoldCountdown v-if="holdEndsAt" :held-until="holdEndsAt" @expired="onHoldExpired" />
          <p v-if="holdNotice" class="hold-notice" role="status">{{ holdNotice }}</p>
          <CartTotals :summary="cart.summary" />
          <label class="terms">
            <input v-model="termsAccepted" type="checkbox" name="terms" required />
            <span>
              J'ai lu et j'accepte les
              <NuxtLink to="/cgv" target="_blank" rel="noopener" class="link">conditions générales de vente</NuxtLink>
              (version du {{ termsVersionLabel }}).
            </span>
          </label>
          <!-- Wording required by art. L221-14 of the Code de la consommation: the
               button must say that ordering creates an obligation to pay. -->
          <button type="button" class="btn btn-primary summary__cta" :disabled="placing" @click="placeOrder">
            {{ placing ? "Création…" : "Commander avec obligation de paiement" }}
          </button>
          <p v-if="placeError" class="err" role="alert">{{ placeError }}</p>
          <ul v-if="cartChanges.length" class="cart-changes">
            <li v-for="change in cartChanges" :key="change">{{ change }}</li>
          </ul>
        </aside>
      </div>
    </section>
  </div>
</template>

<style scoped>
.checkout {
  padding-top: clamp(1.5rem, 4vw, 2.5rem);
}
.checkout__title {
  font-size: var(--fs-2xl);
  margin: 0 0 clamp(1.5rem, 4vw, 2.5rem);
}
.state {
  color: var(--paper-dim);
  padding: 1.5rem 0 4rem;
}
.link {
  color: var(--brass);
  text-decoration: underline;
}
.checkout__grid {
  display: grid;
  gap: clamp(1.5rem, 4vw, 3rem);
  grid-template-columns: 1fr;
  padding-bottom: 4rem;
}
.section__h {
  font-size: var(--fs-lg);
  margin: 0 0 1rem;
}
.addr-list {
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
  display: grid;
  gap: 0.6rem;
}
.addr {
  display: flex;
  gap: 0.7rem;
  align-items: start;
  padding: 0.9rem;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  cursor: pointer;
  font-size: var(--fs-base);
  color: var(--paper-dim);
}
.addr strong {
  color: var(--paper);
  display: block;
}
.billing-toggle {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  font-size: var(--fs-base);
  color: var(--paper-dim);
  margin-top: 0.5rem;
}
.split-note {
  margin: 1.75rem 0 0;
  padding: 1rem 1.1rem;
  font-size: var(--fs-sm);
  color: var(--paper-dim);
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  line-height: var(--lh-normal);
}
.summary {
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  padding: 1.5rem;
  align-self: start;
}
.cart-changes {
  margin: 0 0 1rem;
  padding-left: 1.1rem;
  font-size: var(--fs-sm);
  color: var(--paper);
}
.hold-notice {
  margin: 0 0 1rem;
  color: var(--brass);
}
.terms {
  display: flex;
  gap: 0.6rem;
  align-items: start;
  margin: 0 0 1rem;
  font-size: var(--fs-sm);
  color: var(--paper-dim);
  line-height: var(--lh-normal);
  cursor: pointer;
}
.terms input {
  margin-top: 0.2rem;
  flex-shrink: 0;
}
.summary__cta {
  width: 100%;
  justify-content: center;
}
.err {
  color: var(--danger);
  font-size: var(--fs-sm);
  margin: 0.6rem 0 0;
}

@media (min-width: 860px) {
  .checkout__grid {
    grid-template-columns: 1.6fr 1fr;
    align-items: start;
  }
}
</style>
