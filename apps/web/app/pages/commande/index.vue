<script setup lang="ts">
import type { CartView } from "~/types/cart"
import type { Address, NewAddress } from "~/types/checkout"
import { formatEuros } from "~/utils/format"

definePageMeta({ middleware: "auth" })
useHead({ title: "Commande — SCS Firearm" })

const { fetchCart, count: cartCount } = useCart()
const { list: listAddresses, create: createAddress } = useAddresses()
const { create: createOrder } = useOrders()
const router = useRouter()

const cart = ref<CartView | null>(null)
const addresses = ref<Address[]>([])
const pending = ref(true)
const loadError = ref(false)

const shippingId = ref<string>("")
const billingDifferent = ref(false)
const billingId = ref<string>("")

const showAddressForm = ref(false)
const form = reactive<NewAddress>({
  firstName: "",
  lastName: "",
  line1: "",
  line2: "",
  postal: "",
  city: "",
  phone: "",
})
const formError = ref("")
const savingAddress = ref(false)

const placing = ref(false)
const placeError = ref("")

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
    showAddressForm.value = a.length === 0
  } catch {
    loadError.value = true
  } finally {
    pending.value = false
  }
}
onMounted(load)

async function saveAddress() {
  formError.value = ""
  if (!form.firstName || !form.lastName || !form.line1 || !form.postal || !form.city) {
    formError.value = "Renseignez les champs obligatoires."
    return
  }
  savingAddress.value = true
  try {
    const created = await createAddress({ ...form, line2: form.line2 || undefined, phone: form.phone || undefined })
    addresses.value = await listAddresses()
    shippingId.value = created.id
    showAddressForm.value = false
    Object.assign(form, { firstName: "", lastName: "", line1: "", line2: "", postal: "", city: "", phone: "" })
  } catch {
    formError.value = "Impossible d'enregistrer l'adresse."
  } finally {
    savingAddress.value = false
  }
}

async function placeOrder() {
  placeError.value = ""
  if (!shippingId.value) {
    placeError.value = "Choisissez une adresse de livraison."
    return
  }
  placing.value = true
  try {
    const billing = billingDifferent.value && billingId.value ? billingId.value : undefined
    const order = await createOrder(shippingId.value, billing)
    // The order consumes the cart server-side — clear the header badge.
    cartCount.value = 0
    await router.push(`/commande/${order.id}`)
  } catch (err) {
    placeError.value =
      authErrorStatus(err) === 400 ? "Votre panier est vide ou invalide." : "Impossible de créer la commande."
    placing.value = false
  }
}

const addressLine = (a: Address) =>
  `${a.firstName} ${a.lastName} — ${a.line1}${a.line2 ? `, ${a.line2}` : ""}, ${a.postal} ${a.city}`
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

            <ul v-if="addresses.length > 0" class="addr-list" role="list">
              <li v-for="a in addresses" :key="a.id">
                <label class="addr">
                  <input v-model="shippingId" type="radio" name="shipping" :value="a.id" />
                  <span>
                    <strong v-if="a.label">{{ a.label }}</strong>
                    {{ addressLine(a) }}
                  </span>
                </label>
              </li>
            </ul>

            <button v-if="!showAddressForm" type="button" class="btn btn-ghost add-btn" @click="showAddressForm = true">
              Ajouter une adresse
            </button>

            <form v-else class="addr-form" @submit.prevent="saveAddress">
              <div class="row">
                <input v-model="form.firstName" class="input" placeholder="Prénom *" />
                <input v-model="form.lastName" class="input" placeholder="Nom *" />
              </div>
              <input v-model="form.line1" class="input" placeholder="Adresse *" />
              <input v-model="form.line2" class="input" placeholder="Complément" />
              <div class="row">
                <input v-model="form.postal" class="input" placeholder="Code postal *" />
                <input v-model="form.city" class="input" placeholder="Ville *" />
              </div>
              <input v-model="form.phone" class="input" type="tel" placeholder="Téléphone" />
              <p v-if="formError" class="err" role="alert">{{ formError }}</p>
              <div class="addr-form__actions">
                <button type="submit" class="btn btn-primary" :disabled="savingAddress">
                  {{ savingAddress ? "Enregistrement…" : "Enregistrer" }}
                </button>
                <button v-if="addresses.length > 0" type="button" class="btn btn-ghost" @click="showAddressForm = false">
                  Annuler
                </button>
              </div>
            </form>

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
          <dl class="summary__rows">
            <div>
              <dt>Sous-total HT</dt>
              <dd>{{ formatEuros(cart.summary.subtotalHt) }}</dd>
            </div>
            <div v-if="cart.summary.vipDiscountAmount > 0" class="summary__discount">
              <dt>Remise VIP</dt>
              <dd>− {{ formatEuros(cart.summary.vipDiscountAmount) }}</dd>
            </div>
            <div>
              <dt>TVA</dt>
              <dd>{{ formatEuros(cart.summary.vatAmount) }}</dd>
            </div>
            <div class="summary__total">
              <dt>Total TTC</dt>
              <dd>{{ formatEuros(cart.summary.totalTtc) }}</dd>
            </div>
          </dl>
          <button type="button" class="btn btn-primary summary__cta" :disabled="placing" @click="placeOrder">
            {{ placing ? "Création…" : "Valider la commande" }}
          </button>
          <p v-if="placeError" class="err" role="alert">{{ placeError }}</p>
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
  font-size: clamp(2.2rem, 6vw, 3.2rem);
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
  font-size: 1.2rem;
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
  font-size: 0.92rem;
  color: var(--paper-dim);
}
.addr strong {
  color: var(--paper);
  display: block;
}
.add-btn {
  margin-bottom: 1rem;
}
.addr-form {
  display: grid;
  gap: 0.7rem;
  margin-bottom: 1rem;
}
.row {
  display: grid;
  gap: 0.7rem;
  grid-template-columns: 1fr 1fr;
}
.input {
  width: 100%;
  height: 46px;
  padding: 0 0.85rem;
  color: var(--paper);
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  font-family: inherit;
  font-size: 0.95rem;
}
.input:focus {
  outline: none;
  border-color: var(--brass);
}
.addr-form__actions {
  display: flex;
  gap: 0.7rem;
}
.billing-toggle {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  font-size: 0.9rem;
  color: var(--paper-dim);
  margin-top: 0.5rem;
}
.split-note {
  margin: 1.75rem 0 0;
  padding: 1rem 1.1rem;
  font-size: 0.88rem;
  color: var(--paper-dim);
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  line-height: 1.5;
}
.summary {
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  padding: 1.5rem;
  align-self: start;
}
.summary__rows {
  margin: 0 0 1.25rem;
}
.summary__rows > div {
  display: flex;
  justify-content: space-between;
  padding: 0.4rem 0;
}
.summary__rows dt {
  color: var(--paper-dim);
}
.summary__rows dd {
  margin: 0;
}
.summary__discount dd {
  color: var(--brass);
}
.summary__total {
  border-top: 1px solid var(--ink-line);
  margin-top: 0.4rem;
  padding-top: 0.8rem !important;
  font-size: 1.15rem;
  font-weight: 600;
}
.summary__cta {
  width: 100%;
  justify-content: center;
}
.err {
  color: var(--danger);
  font-size: 0.85rem;
  margin: 0.6rem 0 0;
}

@media (min-width: 860px) {
  .checkout__grid {
    grid-template-columns: 1.6fr 1fr;
    align-items: start;
  }
}
</style>
