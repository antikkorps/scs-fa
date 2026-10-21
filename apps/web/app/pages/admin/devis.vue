<script setup lang="ts">
import type { QuoteRequestStatus } from "@armurier/shared"
import type { Pagination } from "~/types/admin"
import type { AdminQuoteRequestDetail, AdminQuoteRequestRow } from "~/types/quote"
import { formatDateTime, formatEuros, formatPercent } from "~/utils/format"
import { organisationTypeLabel, quoteRequestStatus } from "~/utils/organisation"
import { legalCategoryLabel } from "~/utils/product"

// Story 12.8c — the pros' quote requests: SCS sees what was asked, from the
// public prices and the organisation's terms, and takes it in hand. Quoting
// it — prices, Henrri, the PDF — comes with story 12.8d.
definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Devis — Administration SCS" })

const TABS: { value: QuoteRequestStatus | "all"; label: string }[] = [
  { value: "requested", label: "Nouvelles" },
  { value: "in_review", label: "En cours" },
  { value: "all", label: "Toutes" },
]

const api = useApi()
const status = ref<QuoteRequestStatus | "all">("requested")
const page = ref(1)

const { data, pending, error, refresh } = await useAsyncData(
  "admin-quote-requests",
  () => {
    const statusFilter = status.value === "all" ? "" : `status=${status.value}&`
    return api<{ data: AdminQuoteRequestRow[]; pagination: Pagination }>(
      `/admin/quote-requests?${statusFilter}page=${page.value}&limit=20`,
    )
  },
  { server: false, watch: [status, page] },
)
const rows = computed(() => data.value?.data ?? [])
const pagination = computed(() => data.value?.pagination)

function setStatus(next: typeof status.value) {
  status.value = next
  page.value = 1
}

const selected = ref<AdminQuoteRequestDetail | null>(null)
const drawerOpen = ref(false)
const drawerLoading = ref(false)
const acting = ref(false)
const actionError = ref("")

async function open(id: string) {
  drawerOpen.value = true
  drawerLoading.value = true
  selected.value = null
  actionError.value = ""
  try {
    selected.value = (await api<{ data: AdminQuoteRequestDetail }>(`/admin/quote-requests/${id}`)).data
  } catch {
    actionError.value = "Impossible de charger la demande."
  } finally {
    drawerLoading.value = false
  }
}

function close() {
  drawerOpen.value = false
  selected.value = null
}

async function takeInHand() {
  const current = selected.value
  if (!current) return
  acting.value = true
  actionError.value = ""
  try {
    const answer = await api<{ data: Partial<AdminQuoteRequestDetail> }>(`/admin/quote-requests/${current.id}/review`, {
      method: "POST",
    })
    selected.value = { ...current, ...answer.data }
    await refresh()
  } catch (err) {
    actionError.value = (err as { data?: { message?: string } })?.data?.message ?? "L'opération a échoué."
  } finally {
    acting.value = false
  }
}

const requesterName = (row: Pick<AdminQuoteRequestRow, "requester">) =>
  [row.requester.firstName, row.requester.lastName].filter(Boolean).join(" ") || row.requester.email
const publicTotal = (detail: AdminQuoteRequestDetail) =>
  detail.items.reduce((total, item) => total + item.publicPriceHt * item.qty, 0)
</script>

<template>
  <div>
    <header class="head">
      <p class="eyebrow">Clients</p>
      <h1>Demandes de devis</h1>
    </header>

    <div class="tabs" role="group" aria-label="Filtrer par statut">
      <button
        v-for="tab in TABS"
        :key="tab.value"
        type="button"
        class="tab"
        :class="{ 'tab--on': status === tab.value }"
        :aria-pressed="status === tab.value"
        @click="setStatus(tab.value)"
      >
        {{ tab.label }}
      </button>
    </div>

    <p v-if="pending" class="state">Chargement…</p>
    <p v-else-if="error" class="state state--error">Impossible de charger les demandes.</p>
    <p v-else-if="rows.length === 0" class="state">Aucune demande.</p>

    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Reçue le</th>
            <th>Demande</th>
            <th>Organisation</th>
            <th>Lignes</th>
            <th>Statut</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id" class="row" tabindex="0" @click="open(row.id)" @keydown.enter="open(row.id)">
            <td>{{ formatDateTime(row.createdAt) }}</td>
            <td class="strong">{{ row.number }}</td>
            <td>
              <span class="strong">{{ row.organisation.legalName }}</span>
              <span class="sub">{{ organisationTypeLabel(row.organisation.type) }} · {{ requesterName(row) }}</span>
            </td>
            <td>{{ row.lineCount }}</td>
            <td><AdminStatusTag v-bind="quoteRequestStatus(row.status)" /></td>
          </tr>
        </tbody>
      </table>
    </div>

    <nav v-if="pagination && pagination.totalPages > 1" class="pager">
      <button class="btn btn-ghost" :disabled="page <= 1" @click="page--">Précédent</button>
      <span class="pager__info">Page {{ pagination.page }} / {{ pagination.totalPages }}</span>
      <button class="btn btn-ghost" :disabled="!pagination.hasMore" @click="page++">Suivant</button>
    </nav>

    <AdminDrawer v-if="drawerOpen" :label="selected?.number ?? 'Demande de devis'" @close="close">
      <p v-if="drawerLoading" class="state">Chargement…</p>
      <p v-else-if="!selected" class="error" role="alert">{{ actionError }}</p>

      <template v-else>
        <p class="eyebrow">{{ selected.organisation.legalName }}</p>
        <h2 class="drawer-title">{{ selected.number }}</h2>
        <p class="drawer-sub"><AdminStatusTag v-bind="quoteRequestStatus(selected.status)" /></p>

        <dl class="meta">
          <div><dt>Reçue le</dt><dd>{{ formatDateTime(selected.createdAt) }}</dd></div>
          <div><dt>Demandeur</dt><dd>{{ requesterName(selected) }}<br /><span class="sub">{{ selected.requester.email }}</span></dd></div>
          <div><dt>Remise du compte</dt><dd>{{ formatPercent(selected.organisation.discountPct) }}</dd></div>
          <div>
            <dt>Paiement</dt>
            <dd>{{ selected.organisation.net30Allowed ? "Paiement à 30 jours autorisé" : "Carte ou virement" }}</dd>
          </div>
        </dl>

        <section class="block">
          <h3 class="block__h">Articles demandés</h3>
          <ul class="lines" role="list">
            <li v-for="item in selected.items" :key="item.id" class="line">
              <span class="line__main">
                <span class="strong">{{ item.productName }}</span>
                <span class="sub">
                  <template v-if="item.variantLabel">{{ item.variantLabel }} · </template>{{ item.variantSku ?? item.productSku }} ·
                  {{ legalCategoryLabel(item.legalCategory) }}
                </span>
              </span>
              <span class="line__figures">
                <span>× {{ item.qty }}</span>
                <span class="sub">{{ formatEuros(item.publicPriceHt) }} HT public</span>
              </span>
            </li>
          </ul>
          <p class="hint">Total au prix public : {{ formatEuros(publicTotal(selected)) }} HT, avant remise.</p>
        </section>

        <section v-if="selected.message" class="block">
          <h3 class="block__h">Message du client</h3>
          <p class="message">{{ selected.message }}</p>
        </section>

        <p v-if="actionError" class="error" role="alert">{{ actionError }}</p>
        <div v-if="selected.status === 'requested'" class="actions">
          <button type="button" class="btn btn-primary take" :disabled="acting" @click="takeInHand">Prendre en charge</button>
        </div>
        <p v-else class="hint">L'établissement du devis arrive avec la prochaine étape (12.8d).</p>
      </template>
    </AdminDrawer>
  </div>
</template>

<style scoped>
.head {
  margin-bottom: 1.2rem;
}
.head h1 {
  font-size: var(--fs-2xl);
  margin-top: 0.3rem;
}
.tabs {
  display: flex;
  gap: 0.4rem;
  margin-bottom: 1.4rem;
  flex-wrap: wrap;
}
.tab {
  background: transparent;
  border: 1px solid var(--ink-line);
  color: var(--paper-dim);
  padding: 0.5rem 1rem;
  border-radius: 999px;
  font-size: var(--fs-sm);
  cursor: pointer;
}
.tab--on {
  color: var(--brass);
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
  font-size: var(--fs-sm);
  min-width: 680px;
}
.table th {
  text-align: left;
  font-size: var(--fs-xs);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--paper-faint);
  font-weight: var(--fw-semibold);
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--ink-line);
  background: var(--ink-soft);
}
.table td {
  padding: 0.8rem 1rem;
  border-bottom: 1px solid var(--ink-line);
  vertical-align: top;
}
.row {
  cursor: pointer;
}
.row:hover,
.row:focus-visible {
  background: rgba(255, 255, 255, 0.025);
}
.row:last-child td {
  border-bottom: none;
}
.strong {
  display: block;
  font-weight: var(--fw-semibold);
}
.sub {
  display: block;
  color: var(--paper-faint);
  font-size: var(--fs-xs);
  margin-top: 0.15rem;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 1.4rem;
}
.pager__info {
  font-size: var(--fs-sm);
  color: var(--paper-dim);
}
.state {
  color: var(--paper-dim);
  padding: 2rem 0;
}
.state--error,
.error {
  color: var(--danger);
}
.drawer-title {
  font-size: var(--fs-xl);
  margin: 0.3rem 0 0.4rem;
}
.drawer-sub {
  margin: 0 0 1.4rem;
}
.meta {
  margin: 0 0 1.2rem;
}
.meta div {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--ink-line);
}
.meta dt {
  color: var(--paper-faint);
  font-size: var(--fs-sm);
}
.meta dd {
  margin: 0;
  text-align: right;
}
.block {
  margin: 1.4rem 0;
}
.block__h {
  font-size: var(--fs-md);
  margin: 0 0 0.8rem;
}
.lines {
  list-style: none;
  margin: 0;
  padding: 0;
}
.line {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.6rem 0;
  border-bottom: 1px solid var(--ink-line);
}
.line__figures {
  text-align: right;
  white-space: nowrap;
}
.message {
  color: var(--paper-dim);
  white-space: pre-line;
  margin: 0;
}
.actions {
  margin-top: 1rem;
}
.hint {
  color: var(--paper-faint);
  font-size: var(--fs-sm);
  margin-top: 0.6rem;
}
</style>
