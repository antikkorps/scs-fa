<script setup lang="ts">
import type { OrdersSummary } from "~/types/admin"

definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Tableau de bord — Administration SCS" })

const api = useApi()
const { data, pending, error } = await useAsyncData(
  "admin-summary",
  () => api<{ data: OrdersSummary }>("/admin/orders/summary"),
  { server: false },
)
const summary = computed(() => data.value?.data)

const cards = computed(() => {
  const s = summary.value
  if (!s) return []
  return [
    { label: "Commandes", value: s.totalOrders, hint: "total", to: "/admin/orders", tone: "neutral" },
    {
      label: "À encaisser",
      value: s.awaitingPayment,
      hint: "paiement en attente",
      to: "/admin/orders?paymentStatus=pending",
      tone: "warn",
    },
    { label: "Payées", value: s.paid, hint: "encaissées", to: "/admin/orders?paymentStatus=received", tone: "ok" },
    {
      label: "Docs à vérifier",
      value: s.docsToReview,
      hint: "file de validation",
      to: "/admin/legal-docs",
      tone: "warn",
    },
    {
      label: "Docs rejetés",
      value: s.docsRejected,
      hint: "à corriger",
      to: "/admin/orders?legalStatus=docs_rejected",
      tone: "bad",
    },
    {
      label: "Remboursées",
      value: s.refunded,
      hint: "totalement",
      to: "/admin/orders?paymentStatus=refunded",
      tone: "neutral",
    },
  ]
})
</script>

<template>
  <div>
    <header class="head">
      <p class="eyebrow">Vue d'ensemble</p>
      <h1>Tableau de bord</h1>
    </header>

    <p v-if="pending" class="state">Chargement…</p>
    <p v-else-if="error" class="state state--error">Impossible de charger les indicateurs.</p>

    <div v-else class="cards">
      <NuxtLink v-for="c in cards" :key="c.label" :to="c.to" class="card" :class="`card--${c.tone}`">
        <span class="card__value">{{ c.value }}</span>
        <span class="card__label">{{ c.label }}</span>
        <span class="card__hint">{{ c.hint }}</span>
      </NuxtLink>
    </div>
  </div>
</template>

<style scoped>
.head {
  margin-bottom: 1.8rem;
}
.head h1 {
  font-size: clamp(1.9rem, 5vw, 2.6rem);
  margin-top: 0.3rem;
}
.cards {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
}
.card {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 1.3rem 1.2rem;
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-left-width: 3px;
  border-radius: var(--radius);
  transition:
    transform 0.3s var(--ease),
    border-color 0.3s var(--ease);
}
.card:hover {
  transform: translateY(-2px);
  border-color: var(--brass);
}
.card__value {
  font-family: var(--font-display);
  font-size: 2.4rem;
  font-weight: 700;
  line-height: 1;
}
.card__label {
  font-size: 0.9rem;
  font-weight: 600;
  margin-top: 0.4rem;
}
.card__hint {
  font-size: 0.74rem;
  color: var(--paper-faint);
}
.card--ok {
  border-left-color: var(--brass);
}
.card--warn {
  border-left-color: #e0b15f;
}
.card--bad {
  border-left-color: var(--danger);
}
.card--neutral {
  border-left-color: var(--ink-line);
}
.state {
  color: var(--paper-dim);
  padding: 2rem 0;
}
.state--error {
  color: var(--danger);
}
</style>
