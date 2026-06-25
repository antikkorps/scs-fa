<script setup lang="ts">
import type { OrderSummary, Pagination } from "~/types/account"
import { formatDate, formatEuros } from "~/utils/format"
import { legalStatusLabel, paymentStatusLabel, statusTone } from "~/utils/order"

definePageMeta({ middleware: "auth" })
useHead({ title: "Mes commandes — SCS Firearm" })

const { list } = useOrders()

const orders = ref<OrderSummary[]>([])
const pagination = ref<Pagination | null>(null)
const page = ref(1)
const pending = ref(true)
const error = ref(false)

async function load() {
  pending.value = true
  error.value = false
  try {
    const res = await list(page.value)
    orders.value = res.data
    pagination.value = res.pagination
  } catch {
    error.value = true
  } finally {
    pending.value = false
  }
}
onMounted(load)

async function goTo(p: number) {
  page.value = p
  await load()
  if (import.meta.client) window.scrollTo({ top: 0 })
}
</script>

<template>
  <div class="orders">
    <section class="container orders__inner">
      <nav class="crumbs" aria-label="Fil d'Ariane">
        <NuxtLink to="/compte" class="link">Mon compte</NuxtLink> <span aria-hidden="true">/</span> Mes commandes
      </nav>
      <h1 class="orders__title">Mes commandes</h1>

      <p v-if="pending" class="state">Chargement…</p>
      <p v-else-if="error" class="state">Impossible de charger vos commandes. Veuillez réessayer.</p>
      <p v-else-if="orders.length === 0" class="state">
        Vous n'avez pas encore de commande.
        <NuxtLink to="/boutique" class="link">Découvrir la boutique</NuxtLink>.
      </p>

      <template v-else>
        <ul class="list" role="list">
          <li v-for="o in orders" :key="o.id">
            <NuxtLink :to="`/compte/commandes/${o.id}`" class="card">
              <div class="card__main">
                <p class="card__ref">Commande {{ o.id.slice(0, 8).toUpperCase() }}</p>
                <p class="card__meta">
                  {{ formatDate(o.createdAt) }} · {{ o.itemCount }} article{{ o.itemCount > 1 ? "s" : "" }}
                </p>
              </div>
              <div class="card__side">
                <p class="card__total">{{ formatEuros(o.totalTtc) }}</p>
                <div class="card__tags">
                  <span class="tag" :class="`tone-${statusTone(o.paymentStatus)}`">
                    {{ paymentStatusLabel(o.paymentStatus) }}
                  </span>
                  <span class="tag" :class="`tone-${statusTone(o.legalVerificationStatus)}`">
                    {{ legalStatusLabel(o.legalVerificationStatus) }}
                  </span>
                </div>
              </div>
              <span class="card__chev" aria-hidden="true">›</span>
            </NuxtLink>
          </li>
        </ul>

        <nav v-if="pagination && pagination.totalPages > 1" class="pager" aria-label="Pagination">
          <button type="button" class="btn btn-ghost" :disabled="page <= 1" @click="goTo(page - 1)">Précédent</button>
          <span class="pager__pos">Page {{ pagination.page }} / {{ pagination.totalPages }}</span>
          <button type="button" class="btn btn-ghost" :disabled="!pagination.hasMore" @click="goTo(page + 1)">
            Suivant
          </button>
        </nav>
      </template>
    </section>
  </div>
</template>

<style scoped>
.orders {
  padding-top: clamp(1.5rem, 4vw, 2.5rem);
}
.orders__inner {
  max-width: 820px;
  padding-bottom: 4rem;
}
.crumbs {
  font-size: 0.8rem;
  color: var(--paper-dim);
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 0.75rem;
}
.orders__title {
  font-size: clamp(1.8rem, 5vw, 2.5rem);
  margin: 0 0 1.75rem;
}
.link {
  color: var(--brass);
  text-decoration: underline;
}
.state {
  color: var(--paper-dim);
  padding: 1rem 0 3rem;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.75rem;
}
.card {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.1rem 1.25rem;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  background: var(--ink-soft);
  transition: border-color 0.25s var(--ease);
}
.card:hover {
  border-color: var(--brass);
}
.card__main {
  flex: 1;
  min-width: 0;
}
.card__ref {
  margin: 0 0 0.25rem;
  font-weight: 600;
  color: var(--paper);
}
.card__meta {
  margin: 0;
  font-size: 0.85rem;
  color: var(--paper-dim);
}
.card__side {
  text-align: right;
}
.card__total {
  margin: 0 0 0.4rem;
  font-family: var(--font-display);
  color: var(--brass);
}
.card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  justify-content: flex-end;
}
.tag {
  font-size: 0.7rem;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--ink-line);
  color: var(--paper-dim);
}
.tag.tone-positive {
  color: var(--brass);
  border-color: color-mix(in srgb, var(--brass) 45%, transparent);
}
.tag.tone-negative {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 45%, transparent);
}
.card__chev {
  color: var(--brass);
  font-size: 1.5rem;
  line-height: 1;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.25rem;
  margin-top: 2rem;
}
.pager__pos {
  font-size: 0.85rem;
  color: var(--paper-dim);
}
@media (max-width: 560px) {
  .card {
    flex-wrap: wrap;
  }
  .card__chev {
    display: none;
  }
}
</style>
