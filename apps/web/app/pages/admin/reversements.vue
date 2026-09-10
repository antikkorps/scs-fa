<script setup lang="ts">
import type { AdminBeneficiary, AdminPayout } from "~/types/admin-finance"
import { formatDate, formatEuros } from "~/utils/format"

definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Reversements — Administration SCS" })

const api = useApi()
const beneficiaryFilter = ref("")
const statusFilter = ref("")

const query = computed(() => {
  const p = new URLSearchParams()
  if (beneficiaryFilter.value) p.set("beneficiaryId", beneficiaryFilter.value)
  if (statusFilter.value) p.set("status", statusFilter.value)
  const qs = p.toString()
  return qs ? `?${qs}` : ""
})

const { data: beneficiariesData } = await useAsyncData("payout-beneficiaries", () =>
  api<{ data: AdminBeneficiary[] }>("/admin/finance/beneficiaries"),
)
const { data, pending, error, refresh } = await useAsyncData(
  "admin-payouts",
  () => api<{ data: AdminPayout[] }>(`/admin/finance/payouts${query.value}`),
  { server: false, watch: [query] },
)

const payouts = computed(() => data.value?.data ?? [])
const beneficiaries = computed(() => beneficiariesData.value?.data ?? [])
const actionError = ref<string | null>(null)

const STATUS_LABELS: Record<string, string> = {
  pending: "À venir",
  due: "Dû",
  paid: "Versé",
  cancelled: "Annulé",
}

async function setStatus(row: AdminPayout, status: "due" | "paid") {
  actionError.value = null
  try {
    await api(`/admin/finance/payouts/${row.id}`, { method: "PATCH", body: { status } })
    await refresh()
  } catch (err) {
    const body = (err as { data?: { message?: string } }).data
    actionError.value = body?.message ?? "L'opération a échoué."
  }
}

const totalDue = computed(() => payouts.value.filter((p) => p.status === "due").reduce((sum, p) => sum + p.amountHt, 0))
</script>

<template>
  <div>
    <header class="head">
      <div>
        <p class="eyebrow">Finance</p>
        <h1>Reversements</h1>
      </div>
      <NuxtLink to="/admin/beneficiaires" class="btn-add">Gérer les bénéficiaires</NuxtLink>
    </header>

    <p class="intro">
      Ce qui est dû à un tiers sur chaque vente. Le taux, la base et le montant ont été <strong>figés à la
      commande</strong> : renégocier un taux aujourd'hui ne réécrit pas ce qui était dû hier. Un remboursement réduit
      la part d'autant, et un reversement déjà versé n'est plus touché.
    </p>

    <div class="filters">
      <label class="field">
        <span class="field__label">Bénéficiaire</span>
        <select v-model="beneficiaryFilter" class="ctl">
          <option value="">Tous</option>
          <option v-for="b in beneficiaries" :key="b.id" :value="b.id">{{ b.name }}</option>
        </select>
      </label>
      <label class="field">
        <span class="field__label">Statut</span>
        <select v-model="statusFilter" class="ctl">
          <option value="">Tous</option>
          <option v-for="(label, value) in STATUS_LABELS" :key="value" :value="value">{{ label }}</option>
        </select>
      </label>
      <p class="total">Total dû affiché : <strong>{{ formatEuros(totalDue) }}</strong> HT</p>
    </div>

    <p v-if="actionError" class="alert" role="alert">{{ actionError }}</p>
    <p v-if="pending" class="state">Chargement…</p>
    <p v-else-if="error" class="state state--error">Impossible de charger les reversements.</p>
    <p v-else-if="payouts.length === 0" class="state">Aucun reversement pour ce filtre.</p>

    <section v-else class="panel">
      <div class="tablewrap">
        <table class="grid">
          <thead>
            <tr>
              <th scope="col">Bénéficiaire</th>
              <th scope="col">Article vendu</th>
              <th scope="col">Vente</th>
              <th scope="col">Base HT</th>
              <th scope="col">Taux</th>
              <th scope="col">Montant HT</th>
              <th scope="col">Statut</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in payouts" :key="p.id">
              <td>{{ p.beneficiaryName }}</td>
              <td>{{ p.label }}</td>
              <td class="cell--dim">{{ formatDate(p.orderPlacedAt) }}</td>
              <td class="cell--num">{{ formatEuros(p.baseHt) }}</td>
              <td class="cell--num">{{ p.sharePct }} %</td>
              <td class="cell--num cell--strong">{{ formatEuros(p.amountHt) }}</td>
              <td>
                <span class="badge" :class="`badge--${p.status}`">{{ STATUS_LABELS[p.status] ?? p.status }}</span>
                <span v-if="p.paidAt" class="cell--dim"> · {{ formatDate(p.paidAt) }}</span>
              </td>
              <td class="cell--actions">
                <button v-if="p.status === 'due'" class="link" type="button" @click="setStatus(p, 'paid')">
                  Marquer versé
                </button>
                <button v-else-if="p.status === 'paid'" class="link" type="button" @click="setStatus(p, 'due')">
                  Annuler le versement
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.eyebrow {
  margin: 0;
  font-size: 0.72rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--paper-faint);
}
h1 {
  margin: 0.3rem 0 0;
  font-size: clamp(1.9rem, 5vw, 2.6rem);
}
.btn-add {
  padding: 0.55rem 1rem;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper-dim);
  font-size: 0.85rem;
  text-decoration: none;
}
.btn-add:hover {
  border-color: var(--brass);
  color: var(--brass);
}
.intro {
  max-width: 78ch;
  margin: 0 0 1.5rem;
  color: var(--paper-dim);
  font-size: 0.9rem;
  line-height: 1.7;
}
.intro strong {
  color: var(--paper);
}
.filters {
  display: flex;
  gap: 1.2rem;
  align-items: flex-end;
  flex-wrap: wrap;
  margin-bottom: 1.4rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.field__label {
  font-size: 0.72rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--paper-faint);
  font-weight: 600;
}
.ctl {
  padding: 0.5rem 0.7rem;
  background: var(--ink);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper);
  font-family: inherit;
  font-size: 0.9rem;
}
.total {
  margin: 0 0 0.4rem;
  font-size: 0.88rem;
  color: var(--paper-dim);
}
.total strong {
  color: var(--brass);
  font-variant-numeric: tabular-nums;
}
.panel {
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  padding: 1.3rem 1.4rem;
}
.tablewrap {
  overflow-x: auto;
}
.grid {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}
.grid th,
.grid td {
  padding: 0.55rem 0.7rem;
  border-bottom: 1px solid var(--ink-line);
  text-align: left;
}
.grid thead th {
  color: var(--paper-faint);
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  white-space: nowrap;
}
.cell--num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.cell--strong {
  color: var(--paper);
  font-weight: 600;
}
.cell--dim {
  color: var(--paper-faint);
  font-size: 0.8rem;
}
.cell--actions {
  text-align: right;
  white-space: nowrap;
}
.badge {
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  border: 1px solid var(--ink-line);
  color: var(--paper-dim);
}
.badge--due {
  border-color: var(--brass);
  color: var(--brass);
}
.badge--paid {
  border-color: rgba(188, 215, 178, 0.4);
  color: #9cc48f;
}
.badge--cancelled {
  border-color: rgba(217, 138, 106, 0.35);
  color: var(--danger);
}
.link {
  background: none;
  border: 0;
  color: var(--paper-dim);
  font: inherit;
  font-size: 0.82rem;
  cursor: pointer;
  padding: 0;
}
.link:hover {
  color: var(--brass);
}
.alert {
  background: rgba(217, 138, 106, 0.12);
  border: 1px solid rgba(217, 138, 106, 0.35);
  color: var(--danger);
  padding: 0.7rem 1rem;
  border-radius: var(--radius);
  margin: 0 0 1.2rem;
  font-size: 0.88rem;
}
.state {
  color: var(--paper-dim);
  padding: 1.5rem 0;
}
.state--error {
  color: var(--danger);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
</style>
