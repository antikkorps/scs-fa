<script setup lang="ts">
import type { BankImportReport, Pagination, VirementRow } from "~/types/admin"
import { formatDateTime, formatEuros } from "~/utils/format"
import { paymentStatus } from "~/utils/status"

definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Virements — Administration SCS" })

const api = useApi()
const status = ref<"awaiting_transfer" | "transfer_claimed" | "reconciled" | "all">("awaiting_transfer")
const page = ref(1)

const TABS = [
  { key: "awaiting_transfer", label: "En attente" },
  { key: "transfer_claimed", label: "Déclarés" },
  { key: "reconciled", label: "Rapprochés" },
  { key: "all", label: "Tous" },
] as const

const { data, pending, error, refresh } = await useAsyncData(
  "admin-virements",
  () =>
    api<{ data: VirementRow[]; pagination: Pagination }>(
      `/admin/payments/virements?status=${status.value}&page=${page.value}&limit=20`,
    ),
  { server: false, watch: [status, page] },
)
const rows = computed(() => data.value?.data ?? [])
const pagination = computed(() => data.value?.pagination)

const ACTIONABLE = ["awaiting_transfer", "transfer_claimed"]

// Reconcile drawer
const selected = ref<VirementRow | null>(null)
const amountReceived = ref<number | null>(null)
const receivedFromIban = ref("")
const notes = ref("")
const busy = ref(false)
const actionError = ref("")

function open(row: VirementRow) {
  selected.value = row
  actionError.value = ""
  amountReceived.value = Number(row.amountExpectedTtc)
  receivedFromIban.value = row.clientReportedIban ?? ""
  notes.value = ""
}
function close() {
  selected.value = null
}

async function reconcile() {
  if (!selected.value) return
  if (!amountReceived.value || amountReceived.value <= 0) {
    actionError.value = "Montant reçu invalide."
    return
  }
  busy.value = true
  actionError.value = ""
  try {
    await api(`/admin/payments/virements/${selected.value.id}/reconcile`, {
      method: "POST",
      body: {
        amountReceived: amountReceived.value,
        ...(receivedFromIban.value.trim() ? { receivedFromIban: receivedFromIban.value.trim() } : {}),
        ...(notes.value.trim() ? { notes: notes.value.trim() } : {}),
      },
    })
    close()
    await refresh()
  } catch (err) {
    actionError.value = (err as { data?: { message?: string } })?.data?.message ?? "Le rapprochement a échoué."
  } finally {
    busy.value = false
  }
}

// CSV import
const showImport = ref(false)
const csv = ref("")
const importBusy = ref(false)
const importError = ref("")
const report = ref<BankImportReport | null>(null)

const OUTCOME_LABELS: Record<string, string> = {
  reconciled: "Rapproché",
  amount_mismatch: "Montant divergent",
  unknown_reference: "Référence inconnue",
  no_reference: "Sans référence",
  not_a_credit: "Non crédit",
}

async function runImport() {
  if (!csv.value.trim()) {
    importError.value = "Collez le contenu du relevé CSV."
    return
  }
  importBusy.value = true
  importError.value = ""
  report.value = null
  try {
    const res = await api<{ data: BankImportReport }>("/admin/payments/import", {
      method: "POST",
      body: { csv: csv.value },
    })
    report.value = res.data
    await refresh()
  } catch (err) {
    importError.value = (err as { data?: { message?: string } })?.data?.message ?? "Import impossible."
  } finally {
    importBusy.value = false
  }
}

function setStatus(s: typeof status.value) {
  status.value = s
  page.value = 1
}
</script>

<template>
  <div>
    <header class="head">
      <div>
        <p class="eyebrow">Encaissement</p>
        <h1>Virements</h1>
      </div>
      <button class="btn btn-ghost" type="button" @click="showImport = !showImport">
        {{ showImport ? "Masquer l'import" : "Importer un relevé CSV" }}
      </button>
    </header>

    <section v-if="showImport" class="import">
      <p class="import__hint">
        Collez le relevé bancaire (CSV). Les lignes dont la référence correspond à un virement en attente et dont le
        montant concorde au centime sont rapprochées automatiquement ; le reste est listé pour revue.
      </p>
      <textarea v-model="csv" class="import__area" rows="5" placeholder="Date;Libellé;Montant;IBAN…" />
      <div class="import__actions">
        <button class="btn btn-primary" type="button" :disabled="importBusy" @click="runImport">
          {{ importBusy ? "Import…" : "Lancer l'import" }}
        </button>
        <span v-if="importError" class="err">{{ importError }}</span>
      </div>
      <div v-if="report" class="report">
        <p class="report__summary">
          {{ report.total }} lignes · <strong class="ok">{{ report.reconciled }} rapprochées</strong> ·
          {{ report.needsReview }} à revoir
        </p>
        <ul class="report__lines">
          <li v-for="(l, i) in report.lines" :key="i" :class="`out--${l.outcome}`">
            <span class="report__outcome">{{ OUTCOME_LABELS[l.outcome] ?? l.outcome }}</span>
            <span class="report__label">{{ l.label }}</span>
            <span class="report__amt">{{ formatEuros(l.amount) }}</span>
          </li>
        </ul>
      </div>
    </section>

    <div class="tabs">
      <button v-for="t in TABS" :key="t.key" class="tab" :class="{ 'tab--on': status === t.key }" @click="setStatus(t.key)">
        {{ t.label }}
      </button>
    </div>

    <p v-if="pending" class="state">Chargement…</p>
    <p v-else-if="error" class="state state--error">Impossible de charger les virements.</p>
    <p v-else-if="rows.length === 0" class="state">Aucun virement pour ce statut.</p>

    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Référence</th>
            <th>Client</th>
            <th class="num">Attendu</th>
            <th class="num">Reçu</th>
            <th>Statut</th>
            <th>Créé</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="row" @click="open(r)">
            <td class="mono">{{ r.paymentReference }}</td>
            <td>
              <span class="email">{{ r.user.email }}</span>
              <span v-if="r.clientReportedDate" class="claim">déclaré le {{ r.clientReportedDate }}</span>
            </td>
            <td class="num strong">{{ formatEuros(Number(r.amountExpectedTtc)) }}</td>
            <td class="num">{{ r.amountReceivedTtc ? formatEuros(Number(r.amountReceivedTtc)) : "—" }}</td>
            <td><AdminStatusTag v-bind="paymentStatus(r.paymentStatus)" /></td>
            <td>{{ formatDateTime(r.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <nav v-if="pagination && pagination.totalPages > 1" class="pager">
      <button class="btn btn-ghost" :disabled="page <= 1" @click="page--">Précédent</button>
      <span class="pager__info">Page {{ pagination.page }} / {{ pagination.totalPages }}</span>
      <button class="btn btn-ghost" :disabled="!pagination.hasMore" @click="page++">Suivant</button>
    </nav>

    <!-- Reconcile drawer -->
    <div v-if="selected" class="drawer-scrim" @click.self="close">
      <aside class="drawer">
        <button class="drawer__close" type="button" aria-label="Fermer" @click="close">✕</button>
        <p class="eyebrow">Virement</p>
        <h2 class="drawer__title mono">{{ selected.paymentReference }}</h2>
        <p class="drawer__sub">{{ selected.user.email }}</p>

        <dl class="meta">
          <div><dt>Statut</dt><dd><AdminStatusTag v-bind="paymentStatus(selected.paymentStatus)" /></dd></div>
          <div><dt>Montant attendu</dt><dd>{{ formatEuros(Number(selected.amountExpectedTtc)) }}</dd></div>
          <div v-if="selected.clientReportedAmount">
            <dt>Déclaré par le client</dt>
            <dd>{{ formatEuros(Number(selected.clientReportedAmount)) }}<template v-if="selected.clientReportedDate"> · {{ selected.clientReportedDate }}</template></dd>
          </div>
          <div v-if="selected.clientReportedIban"><dt>IBAN déclaré</dt><dd class="mono">{{ selected.clientReportedIban }}</dd></div>
          <div v-if="selected.clientNotes"><dt>Note client</dt><dd>{{ selected.clientNotes }}</dd></div>
          <div v-if="selected.receivedAt"><dt>Reçu le</dt><dd>{{ formatDateTime(selected.receivedAt) }}</dd></div>
        </dl>

        <template v-if="ACTIONABLE.includes(selected.paymentStatus)">
          <h3 class="sub-h">Confirmer la réception</h3>
          <form @submit.prevent="reconcile">
            <label class="field">
              <span>Montant reçu (€)</span>
              <input v-model.number="amountReceived" type="number" step="0.01" min="0.01" class="ctl" />
            </label>
            <label class="field">
              <span>IBAN émetteur (optionnel)</span>
              <input v-model="receivedFromIban" type="text" maxlength="50" class="ctl" />
            </label>
            <label class="field">
              <span>Note (optionnelle)</span>
              <textarea v-model="notes" class="ctl" rows="2" />
            </label>
            <p v-if="actionError" class="err" role="alert">{{ actionError }}</p>
            <button type="submit" class="btn btn-primary full" :disabled="busy">
              {{ busy ? "En cours…" : "Marquer reçu & rapprocher" }}
            </button>
          </form>
        </template>
        <p v-else class="reconciled-note">
          Virement {{ paymentStatus(selected.paymentStatus).label.toLowerCase() }}.
          <template v-if="selected.reconciliationNotes"><br />{{ selected.reconciliationNotes }}</template>
        </p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.2rem;
}
.head h1 {
  font-size: clamp(1.9rem, 5vw, 2.6rem);
  margin-top: 0.3rem;
}
.import {
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  padding: 1.2rem 1.3rem;
  margin-bottom: 1.4rem;
}
.import__hint {
  color: var(--paper-dim);
  font-size: 0.85rem;
  margin: 0 0 0.8rem;
}
.import__area {
  width: 100%;
  background: var(--ink);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper);
  font-family: ui-monospace, monospace;
  font-size: 0.82rem;
  padding: 0.7rem;
  resize: vertical;
}
.import__actions {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 0.8rem;
}
.report {
  margin-top: 1rem;
  border-top: 1px solid var(--ink-line);
  padding-top: 0.9rem;
}
.report__summary {
  font-size: 0.9rem;
  margin: 0 0 0.6rem;
}
.report__lines {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.report__lines li {
  display: flex;
  gap: 0.8rem;
  align-items: center;
  font-size: 0.82rem;
  padding: 0.3rem 0;
  border-bottom: 1px solid var(--ink-line);
}
.report__outcome {
  min-width: 130px;
  font-weight: 600;
  font-size: 0.72rem;
}
.out--reconciled .report__outcome {
  color: var(--brass);
}
.out--amount_mismatch .report__outcome {
  color: #e0b15f;
}
.out--unknown_reference .report__outcome,
.out--no_reference .report__outcome,
.out--not_a_credit .report__outcome {
  color: var(--paper-faint);
}
.report__label {
  flex: 1;
  color: var(--paper-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.report__amt {
  font-weight: 600;
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
  font-size: 0.82rem;
  cursor: pointer;
  transition:
    color 0.2s,
    border-color 0.2s;
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
  padding: 0.8rem 1rem;
  border-bottom: 1px solid var(--ink-line);
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
.mono {
  font-family: ui-monospace, monospace;
}
.email {
  display: block;
}
.claim {
  display: block;
  font-size: 0.74rem;
  color: var(--paper-faint);
}
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 1.4rem;
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
.err {
  color: var(--danger);
  font-size: 0.85rem;
}

/* Drawer */
.drawer-scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 50;
  display: flex;
  justify-content: flex-end;
}
.drawer {
  width: min(420px, 100%);
  height: 100%;
  overflow-y: auto;
  background: var(--ink-soft);
  border-left: 1px solid var(--ink-line);
  padding: 2rem 1.6rem;
  position: relative;
}
.drawer__close {
  position: absolute;
  top: 1rem;
  right: 1rem;
  background: transparent;
  border: none;
  color: var(--paper-dim);
  font-size: 1.1rem;
  cursor: pointer;
}
.drawer__title {
  font-size: 1.3rem;
  margin: 0.3rem 0 0.2rem;
}
.drawer__sub {
  color: var(--paper-dim);
  font-size: 0.88rem;
  margin: 0 0 1.4rem;
}
.meta {
  margin: 0 0 1rem;
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
  font-size: 0.85rem;
}
.meta dd {
  margin: 0;
  text-align: right;
}
.sub-h {
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--paper-faint);
  margin: 1.4rem 0 0.7rem;
}
.field {
  display: block;
  margin-bottom: 1rem;
}
.field span {
  display: block;
  font-size: 0.72rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--paper-faint);
  margin-bottom: 0.4rem;
}
.ctl {
  width: 100%;
  padding: 0.6rem 0.7rem;
  background: var(--ink);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper);
  font-family: inherit;
  font-size: 0.9rem;
}
.ctl:focus {
  outline: none;
  border-color: var(--brass);
}
.full {
  width: 100%;
  justify-content: center;
}
.reconciled-note {
  color: var(--paper-dim);
  font-size: 0.88rem;
  margin-top: 1rem;
}
</style>
