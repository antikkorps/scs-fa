<script setup lang="ts">
import type { CartView } from "~/types/cart"
import { formatEuros } from "~/utils/format"

definePageMeta({ middleware: "auth" })
useHead({ title: "Mon panier — SCS Firearm" })

const { fetchCart, updateItem, removeItem, removeArtworkItem } = useCart()

const cart = ref<CartView | null>(null)
const pending = ref(true)
const error = ref(false)
const busy = ref(false)

async function load() {
  pending.value = true
  error.value = false
  try {
    cart.value = await fetchCart()
  } catch {
    error.value = true
  } finally {
    pending.value = false
  }
}
onMounted(load)

const isEmpty = computed(
  () => !pending.value && !error.value && cart.value !== null && cart.value.summary.itemCount === 0,
)

// Each mutation returns the recomputed cart; guard against overlapping clicks.
async function run(op: () => Promise<CartView>) {
  if (busy.value) return
  busy.value = true
  try {
    cart.value = await op()
  } catch {
    await load()
  } finally {
    busy.value = false
  }
}

const variantAttrs = (l: { finition: string | null; munition: string | null; couleur: string | null }) =>
  [l.finition, l.munition, l.couleur].filter(Boolean).join(" · ")
</script>

<template>
  <div class="cart">
    <section class="container">
      <h1 class="cart__title">Mon panier</h1>

      <p v-if="pending" class="state">Chargement…</p>
      <p v-else-if="error" class="state">Impossible de charger le panier. Réessayez.</p>
      <p v-else-if="isEmpty" class="state">
        Votre panier est vide. <NuxtLink to="/boutique" class="link">Voir la boutique</NuxtLink>.
      </p>

      <div v-else-if="cart" class="cart__grid">
        <ul class="lines" role="list">
          <li v-for="l in cart.items" :key="l.id" class="line">
            <div class="line__main">
              <p class="line__name">{{ l.name }}</p>
              <p v-if="variantAttrs(l)" class="line__variant">{{ variantAttrs(l) }}</p>
              <p class="line__unit">{{ formatEuros(l.unitPriceHt * (1 + l.vatPct / 100)) }} TTC / unité</p>
            </div>
            <div class="line__qty">
              <button
                type="button"
                aria-label="Diminuer"
                :disabled="busy"
                @click="l.qty <= 1 ? run(() => removeItem(l.id)) : run(() => updateItem(l.id, l.qty - 1))"
              >
                −
              </button>
              <span>{{ l.qty }}</span>
              <button
                type="button"
                aria-label="Augmenter"
                :disabled="busy || (l.stockQty !== null && l.qty >= l.stockQty)"
                @click="run(() => updateItem(l.id, l.qty + 1))"
              >
                +
              </button>
            </div>
            <p class="line__total">{{ formatEuros(l.lineTtc) }}</p>
            <button type="button" class="line__remove" :disabled="busy" aria-label="Retirer" @click="run(() => removeItem(l.id))">
              ✕
            </button>
          </li>

          <li v-for="a in cart.artworkItems" :key="a.id" class="line">
            <div class="line__main">
              <p class="line__name">{{ a.title }}</p>
              <p class="line__variant">Tirage {{ a.printDesignation }} · {{ a.formatId }}</p>
            </div>
            <p class="line__qty line__qty--fixed">1</p>
            <p class="line__total">{{ formatEuros(a.lineTtc) }}</p>
            <button
              type="button"
              class="line__remove"
              :disabled="busy"
              aria-label="Retirer"
              @click="run(() => removeArtworkItem(a.id))"
            >
              ✕
            </button>
          </li>
        </ul>

        <aside class="summary">
          <p v-if="cart.isVip" class="summary__vip">Avantage VIP appliqué</p>
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

          <button type="button" class="btn btn-primary summary__cta" @click="$router.push('/commande')">
            Passer commande
          </button>
          <NuxtLink to="/boutique" class="summary__continue">Continuer mes achats</NuxtLink>
        </aside>
      </div>
    </section>
  </div>
</template>

<style scoped>
.cart {
  padding-top: clamp(1.5rem, 4vw, 2.5rem);
}
.cart__title {
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
.cart__grid {
  display: grid;
  gap: clamp(1.5rem, 4vw, 3rem);
  grid-template-columns: 1fr;
  padding-bottom: 4rem;
}
.lines {
  list-style: none;
  margin: 0;
  padding: 0;
}
.line {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  align-items: center;
  gap: 1rem;
  padding: 1.1rem 0;
  border-bottom: 1px solid var(--ink-line);
}
.line__name {
  margin: 0;
  font-size: 1.05rem;
}
.line__variant {
  margin: 0.2rem 0 0;
  font-size: 0.82rem;
  color: var(--paper-faint);
}
.line__unit {
  margin: 0.2rem 0 0;
  font-size: 0.8rem;
  color: var(--paper-faint);
}
.line__qty {
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
}
.line__qty button {
  width: 32px;
  height: 32px;
  border: 1px solid var(--ink-line);
  background: var(--ink-soft);
  color: var(--paper);
  border-radius: var(--radius);
  cursor: pointer;
}
.line__qty button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.line__qty--fixed {
  color: var(--paper-dim);
}
.line__total {
  margin: 0;
  font-weight: 600;
  min-width: 5rem;
  text-align: right;
}
.line__remove {
  background: transparent;
  border: none;
  color: var(--paper-faint);
  cursor: pointer;
  font-size: 0.9rem;
}
.line__remove:hover {
  color: var(--danger);
}
.summary {
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  padding: 1.5rem;
  align-self: start;
}
.summary__vip {
  margin: 0 0 1rem;
  font-size: 0.78rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--brass);
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
.summary__continue {
  display: block;
  margin: 0.85rem 0 0;
  font-size: 0.85rem;
  color: var(--paper-dim);
  text-align: center;
  text-decoration: underline;
}

@media (min-width: 860px) {
  .cart__grid {
    grid-template-columns: 1.6fr 1fr;
    align-items: start;
  }
}
</style>
