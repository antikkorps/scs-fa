<script setup lang="ts">
import type { LegalDocDetail, LegalDocQueueItem, Pagination } from "~/types/admin"
import { formatDateTime } from "~/utils/format"
import { docTypeLabel, docVerificationStatus, REJECTION_REASON_OPTIONS, rejectionLabel } from "~/utils/status"

definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Documents — Administration SCS" })

const api = useApi()
const status = ref<"pending" | "approved" | "rejected" | "all">("pending")
const page = ref(1)

const { data, pending, error, refresh } = await useAsyncData(
  "admin-docs",
  () =>
    api<{ data: LegalDocQueueItem[]; pagination: Pagination }>(
      `/admin/legal-documents?status=${status.value}&page=${page.value}&limit=20`,
    ),
  { server: false, watch: [status, page] },
)
const docs = computed(() => data.value?.data ?? [])
const pagination = computed(() => data.value?.pagination)

// Detail drawer
const selected = ref<LegalDocDetail | null>(null)
const drawerLoading = ref(false)
const acting = ref(false)
const actionError = ref("")
const rejectReason = ref(REJECTION_REASON_OPTIONS[0]?.value ?? "other")
const rejectNotes = ref("")
const mode = ref<"view" | "reject">("view")

async function open(id: string) {
  mode.value = "view"
  actionError.value = ""
  drawerLoading.value = true
  selected.value = null
  try {
    const res = await api<{ data: LegalDocDetail }>(`/admin/legal-documents/${id}`)
    selected.value = res.data
  } catch {
    actionError.value = "Impossible de charger le document."
  } finally {
    drawerLoading.value = false
  }
}
function close() {
  selected.value = null
  mode.value = "view"
}

async function approve() {
  if (!selected.value) return
  acting.value = true
  actionError.value = ""
  try {
    await api(`/admin/legal-documents/${selected.value.id}/approve`, { method: "POST" })
    close()
    await refresh()
  } catch (err) {
    actionError.value = errorMessage(err, "L'approbation a échoué.")
  } finally {
    acting.value = false
  }
}

async function reject() {
  if (!selected.value) return
  if (rejectReason.value === "other" && !rejectNotes.value.trim()) {
    actionError.value = "Une note est requise pour le motif « Autre »."
    return
  }
  acting.value = true
  actionError.value = ""
  try {
    await api(`/admin/legal-documents/${selected.value.id}/reject`, {
      method: "POST",
      body: { reason: rejectReason.value, ...(rejectNotes.value.trim() ? { notes: rejectNotes.value.trim() } : {}) },
    })
    close()
    await refresh()
  } catch (err) {
    actionError.value = errorMessage(err, "Le rejet a échoué.")
  } finally {
    acting.value = false
  }
}

function errorMessage(err: unknown, fallback: string): string {
  return (err as { data?: { message?: string } })?.data?.message ?? fallback
}
function setStatus(s: typeof status.value) {
  status.value = s
  page.value = 1
}
</script>

<template>
  <div>
    <header class="head">
      <p class="eyebrow">Conformité</p>
      <h1>Documents à vérifier</h1>
    </header>

    <div class="tabs">
      <button v-for="t in (['pending', 'approved', 'rejected', 'all'] as const)" :key="t" class="tab" :class="{ 'tab--on': status === t }" @click="setStatus(t)">
        {{ { pending: "À vérifier", approved: "Approuvés", rejected: "Rejetés", all: "Tous" }[t] }}
      </button>
    </div>

    <p v-if="pending" class="state">Chargement…</p>
    <p v-else-if="error" class="state state--error">Impossible de charger la file.</p>
    <p v-else-if="docs.length === 0" class="state">Aucun document.</p>

    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Déposé le</th>
            <th>Type</th>
            <th>Client</th>
            <th>Antivirus</th>
            <th>Statut</th>
            <th>Échéance</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in docs" :key="d.id" class="row" @click="open(d.id)">
            <td>{{ formatDateTime(d.uploadedAt) }}</td>
            <td>{{ docTypeLabel(d.docType) }}</td>
            <td class="email">{{ d.user.email }}</td>
            <td>
              <span class="scan" :class="`scan--${d.scanStatus}`">{{ d.scanStatus }}</span>
            </td>
            <td><AdminStatusTag v-bind="docVerificationStatus(d.verificationStatus)" /></td>
            <td>
              <span v-if="d.overdue" class="overdue">En retard</span>
              <span v-else class="muted">{{ formatDateTime(d.verificationDeadline) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <nav v-if="pagination && pagination.totalPages > 1" class="pager">
      <button class="btn btn-ghost" :disabled="page <= 1" @click="page--">Précédent</button>
      <span class="pager__info">Page {{ pagination.page }} / {{ pagination.totalPages }}</span>
      <button class="btn btn-ghost" :disabled="!pagination.hasMore" @click="page++">Suivant</button>
    </nav>

    <!-- Detail / action drawer -->
    <div v-if="selected || drawerLoading" class="drawer-scrim" @click.self="close">
      <aside class="drawer">
        <button class="drawer__close" type="button" aria-label="Fermer" @click="close">✕</button>
        <p v-if="drawerLoading" class="state">Chargement…</p>

        <template v-else-if="selected">
          <p class="eyebrow">{{ docTypeLabel(selected.docType) }}</p>
          <h2 class="drawer__title">{{ selected.user.firstname }} {{ selected.user.lastname }}</h2>
          <p class="drawer__email">{{ selected.user.email }}</p>

          <dl class="meta">
            <div><dt>Statut</dt><dd><AdminStatusTag v-bind="docVerificationStatus(selected.verificationStatus)" /></dd></div>
            <div v-if="selected.docNumber"><dt>N° document</dt><dd>{{ selected.docNumber }}</dd></div>
            <div><dt>Antivirus</dt><dd>{{ selected.scanStatus }}</dd></div>
            <div v-if="selected.expiresAt"><dt>Expire le</dt><dd>{{ formatDateTime(selected.expiresAt) }}</dd></div>
          </dl>

          <a :href="selected.downloadUrl" target="_blank" rel="noopener" class="btn btn-ghost dl">Ouvrir le document ↗</a>

          <p v-if="actionError" class="error" role="alert">{{ actionError }}</p>

          <template v-if="selected.verificationStatus === 'pending'">
            <div v-if="mode === 'view'" class="actions">
              <button class="btn btn-primary" :disabled="acting || selected.scanStatus !== 'clean'" @click="approve">
                Approuver
              </button>
              <button class="btn btn-ghost danger" :disabled="acting" @click="mode = 'reject'">Rejeter</button>
            </div>
            <p v-if="mode === 'view' && selected.scanStatus !== 'clean'" class="hint">
              Approbation bloquée tant que l'antivirus n'est pas « clean ».
            </p>

            <form v-else class="reject-form" @submit.prevent="reject">
              <label class="field">
                <span>Motif du rejet</span>
                <select v-model="rejectReason" class="ctl">
                  <option v-for="o in REJECTION_REASON_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>
              </label>
              <label class="field">
                <span>Note {{ rejectReason === "other" ? "(requise)" : "(optionnelle)" }}</span>
                <textarea v-model="rejectNotes" class="ctl" rows="3" />
              </label>
              <div class="actions">
                <button type="submit" class="btn btn-primary danger-solid" :disabled="acting">Confirmer le rejet</button>
                <button type="button" class="btn btn-ghost" :disabled="acting" @click="mode = 'view'">Annuler</button>
              </div>
            </form>
          </template>

          <p v-else-if="selected.rejectionReason" class="hint">
            Motif : {{ rejectionLabel(selected.rejectionReason) }}
          </p>
        </template>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.head {
  margin-bottom: 1.2rem;
}
.head h1 {
  font-size: clamp(1.9rem, 5vw, 2.6rem);
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
.email {
  color: var(--paper-dim);
}
.scan {
  font-size: 0.74rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.scan--clean {
  color: var(--brass);
}
.scan--infected {
  color: var(--danger);
}
.scan--pending {
  color: var(--paper-faint);
}
.overdue {
  color: var(--danger);
  font-weight: 600;
  font-size: 0.8rem;
}
.muted {
  color: var(--paper-faint);
  font-size: 0.82rem;
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
  width: min(440px, 100%);
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
  font-size: 1.5rem;
  margin: 0.3rem 0 0.2rem;
}
.drawer__email {
  color: var(--paper-dim);
  font-size: 0.88rem;
  margin: 0 0 1.4rem;
}
.meta {
  margin: 0 0 1.4rem;
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
.dl {
  width: 100%;
  justify-content: center;
  margin-bottom: 1.4rem;
}
.actions {
  display: flex;
  gap: 0.7rem;
  margin-top: 1rem;
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
.danger {
  color: var(--danger);
  border-color: rgba(217, 138, 106, 0.4);
}
.danger-solid {
  background: var(--danger);
  border-color: var(--danger);
  color: #1a1407;
}
.error {
  color: var(--danger);
  font-size: 0.85rem;
  margin: 1rem 0 0;
}
.hint {
  color: var(--paper-faint);
  font-size: 0.82rem;
  margin-top: 0.8rem;
}
</style>
