<script setup lang="ts">
import type { AdminOrderListItem, Pagination } from "~/types/admin"
import { formatDateTime, formatEuros } from "~/utils/format"
import { LEGAL_STATUS_OPTIONS, legalStatus, PAYMENT_STATUS_OPTIONS, paymentStatus } from "~/utils/status"

definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Commandes — Administration SCS" })

const api = useApi()
const route = useRoute()
const router = useRouter()

// Filters are mirrored in the URL so dashboard deep-links (?paymentStatus=…) land pre-filtered.
const paymentFilter = ref((route.query.paymentStatus as string) || "")
const legalFilter = ref((route.query.legalStatus as string) || "")
const search = ref((route.query.search as string) || "")
const page = ref(Number(route.query.page) || 1)

const query = computed(() => {
  const p = new URLSearchParams()
  if (paymentFilter.value) p.set("paymentStatus", paymentFilter.value)
  if (legalFilter.value) p.set("legalStatus", legalFilter.value)
  if (search.value.trim()) p.set("search", search.value.trim())
  p.set("page", String(page.value))
  p.set("limit", "20")
  return p.toString()
})

const { data, pending, error } = await useAsyncData(
  "admin-orders",
  () => api<{ data: AdminOrderListItem[]; pagination: Pagination }>(`/admin/orders?${query.value}`),
  { server: false, watch: [query] },
)

const orders = computed(() => data.value?.data ?? [])
const pagination = computed(() => data.value?.pagination)

function applyFilters() {
  page.value = 1
  syncUrl()
}
function resetFilters() {
  paymentFilter.value = ""
  legalFilter.value = ""
  search.value = ""
  page.value = 1
  syncUrl()
}
function syncUrl() {
  router.replace({
    query: {
      ...(paymentFilter.value ? { paymentStatus: paymentFilter.value } : {}),
      ...(legalFilter.value ? { legalStatus: legalFilter.value } : {}),
      ...(search.value.trim() ? { search: search.value.trim() } : {}),
      ...(page.value > 1 ? { page: String(page.value) } : {}),
    },
  })
}
function go(delta: number) {
  const next = page.value + delta
  if (next < 1 || (pagination.value && next > pagination.value.totalPages)) return
  page.value = next
  syncUrl()
}

// React to dashboard deep-links that change the query while the page is mounted.
watch(
  () => route.query,
  (q) => {
    paymentFilter.value = (q.paymentStatus as string) || ""
    legalFilter.value = (q.legalStatus as string) || ""
    search.value = (q.search as string) || ""
    page.value = Number(q.page) || 1
  },
)
</script>

<template>
  <div>
    <header class="head">
      <p class="eyebrow">Suivi</p>
      <h1>Commandes</h1>
    </header>

    <form class="filters" @submit.prevent="applyFilters">
      <input v-model="search" class="ctl" type="search" placeholder="Email client…" />
      <select v-model="paymentFilter" class="ctl" @change="applyFilters">
        <option value="">Tous paiements</option>
        <option v-for="o in PAYMENT_STATUS_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
      <select v-model="legalFilter" class="ctl" @change="applyFilters">
        <option value="">Tous statuts légaux</option>
        <option v-for="o in LEGAL_STATUS_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
      <button type="submit" class="btn btn-ghost">Filtrer</button>
      <button type="button" class="btn btn-ghost" @click="resetFilters">Réinitialiser</button>
    </form>

    <p v-if="pending" class="state">Chargement…</p>
    <p v-else-if="error" class="state state--error">Impossible de charger les commandes.</p>
    <p v-else-if="orders.length === 0" class="state">Aucune commande pour ces critères.</p>

    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Client</th>
            <th class="num">Articles</th>
            <th class="num">Total</th>
            <th>Paiement</th>
            <th>Légal</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in orders" :key="o.id" class="row" @click="navigateTo(`/admin/orders/${o.id}`)">
            <td>{{ formatDateTime(o.createdAt) }}</td>
            <td>
              <span class="email">{{ o.user.email }}</span>
              <span v-if="o.user.firstname || o.user.lastname" class="name">
                {{ o.user.firstname }} {{ o.user.lastname }}
              </span>
            </td>
            <td class="num">{{ o.itemCount }}</td>
            <td class="num strong">{{ formatEuros(o.totalTtc) }}</td>
            <td><AdminStatusTag v-bind="paymentStatus(o.paymentStatus)" /></td>
            <td><AdminStatusTag v-bind="legalStatus(o.legalVerificationStatus)" /></td>
          </tr>
        </tbody>
      </table>
    </div>

    <nav v-if="pagination && pagination.totalPages > 1" class="pager">
      <button class="btn btn-ghost" :disabled="page <= 1" @click="go(-1)">Précédent</button>
      <span class="pager__info">Page {{ pagination.page }} / {{ pagination.totalPages }} · {{ pagination.total }} commandes</span>
      <button class="btn btn-ghost" :disabled="!pagination.hasMore" @click="go(1)">Suivant</button>
    </nav>
  </div>
</template>

<style scoped>
.head {
  margin-bottom: 1.4rem;
}
.head h1 {
  font-size: clamp(1.9rem, 5vw, 2.6rem);
  margin-top: 0.3rem;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-bottom: 1.4rem;
}
.ctl {
  padding: 0.6rem 0.8rem;
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper);
  font-family: inherit;
  font-size: 0.88rem;
  min-width: 170px;
}
.ctl:focus {
  outline: none;
  border-color: var(--brass);
}
.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
  min-width: 680px;
}
.table th {
  text-align: left;
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--paper-faint);
  font-weight: 600;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--ink-line);
  background: var(--ink-soft);
}
.table td {
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--ink-line);
  vertical-align: middle;
}
.row {
  cursor: pointer;
  transition: background 0.15s var(--ease);
}
.row:hover {
  background: rgba(255, 255, 255, 0.025);
}
.row:last-child td {
  border-bottom: none;
}
.num {
  text-align: right;
}
.strong {
  font-weight: 600;
}
.email {
  display: block;
}
.name {
  display: block;
  font-size: 0.78rem;
  color: var(--paper-faint);
}
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 1.4rem;
  flex-wrap: wrap;
}
.pager__info {
  font-size: 0.82rem;
  color: var(--paper-dim);
}
.state {
  color: var(--paper-dim);
  padding: 2rem 0;
}
.state--error {
  color: var(--danger);
}
</style>
