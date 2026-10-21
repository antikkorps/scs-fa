<script setup lang="ts">
import type { OrganisationStatus } from "@armurier/shared"
import type { Pagination } from "~/types/admin"
import type { AdminOrganisationDetail, AdminOrganisationRow } from "~/types/organisation"
import { formatDateTime } from "~/utils/format"
import { organisationStatus, organisationTypeLabel, registryCheckLabel } from "~/utils/organisation"

// Story 12.8b — pro accounts: SCS approves, refuses, suspends or reinstates by
// hand, and sets each organisation's commercial terms.
definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Comptes pro — Administration SCS" })

const TABS: { value: OrganisationStatus | "all"; label: string }[] = [
  { value: "pending", label: "À valider" },
  { value: "approved", label: "Validés" },
  { value: "suspended", label: "Suspendus" },
  { value: "rejected", label: "Refusés" },
  { value: "all", label: "Tous" },
]
const MIN_REASON_LENGTH = 3

const api = useApi()
const status = ref<OrganisationStatus | "all">("pending")
const page = ref(1)

const { data, pending, error, refresh } = await useAsyncData(
  "admin-organisations",
  () => {
    const statusFilter = status.value === "all" ? "" : `status=${status.value}&`
    return api<{ data: AdminOrganisationRow[]; pagination: Pagination }>(
      `/admin/organisations?${statusFilter}page=${page.value}&limit=20`,
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

// Drawer
const selected = ref<AdminOrganisationDetail | null>(null)
const drawerOpen = ref(false)
const drawerLoading = ref(false)
const acting = ref(false)
const actionError = ref("")
const mode = ref<"view" | "reject" | "suspend">("view")
const reason = ref("")
const terms = reactive({ discountPct: 0, net30Allowed: false, showPrices: false })

function hydrate(detail: AdminOrganisationDetail) {
  selected.value = detail
  terms.discountPct = detail.discountPct
  // Administrations get the 30-day payment unless SCS unticks it (decision 2026-10-19).
  terms.net30Allowed = detail.status === "pending" ? detail.type === "administration" : detail.net30Allowed
  terms.showPrices = detail.showPrices
}

async function open(id: string) {
  drawerOpen.value = true
  drawerLoading.value = true
  selected.value = null
  mode.value = "view"
  actionError.value = ""
  try {
    hydrate((await api<{ data: AdminOrganisationDetail }>(`/admin/organisations/${id}`)).data)
  } catch {
    actionError.value = "Impossible de charger la fiche."
  } finally {
    drawerLoading.value = false
  }
}

function close() {
  drawerOpen.value = false
  selected.value = null
}

function errorMessage(err: unknown, fallback: string): string {
  return (err as { data?: { message?: string } })?.data?.message ?? fallback
}

const termsBody = () => ({
  discountPct: Number(terms.discountPct),
  net30Allowed: terms.net30Allowed,
  showPrices: terms.showPrices,
})

/** One admin action on the open organisation: the answer replaces the fiche, the list follows. */
async function act(path: string, options: { method: "POST" | "PATCH"; body?: object }, fallback: string) {
  const current = selected.value
  if (!current) return
  acting.value = true
  actionError.value = ""
  try {
    const answer = await api<{ data: AdminOrganisationDetail }>(`/admin/organisations/${current.id}${path}`, options)
    hydrate({ ...current, ...answer.data, member: current.member })
    mode.value = "view"
    reason.value = ""
    await refresh()
  } catch (err) {
    actionError.value = errorMessage(err, fallback)
  } finally {
    acting.value = false
  }
}

const approve = () => act("/approve", { method: "POST", body: termsBody() }, "La validation a échoué.")
const saveTerms = () => act("", { method: "PATCH", body: termsBody() }, "L'enregistrement a échoué.")
const reinstate = () => act("/reinstate", { method: "POST" }, "Le rétablissement a échoué.")

function askReason(next: "reject" | "suspend") {
  mode.value = next
  reason.value = ""
  actionError.value = ""
}

async function confirmWithReason() {
  const written = reason.value.trim()
  if (written.length < MIN_REASON_LENGTH) {
    actionError.value = "Indiquez le motif : il est envoyé tel quel au client."
    return
  }
  const path = mode.value === "reject" ? "/reject" : "/suspend"
  await act(path, { method: "POST", body: { reason: written } }, "L'opération a échoué.")
}

const memberName = (row: AdminOrganisationRow) =>
  [row.member?.firstName, row.member?.lastName].filter(Boolean).join(" ") || "—"
</script>

<template>
  <div>
    <header class="head">
      <p class="eyebrow">Clients</p>
      <h1>Comptes professionnels</h1>
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
    <p v-else-if="error" class="state state--error">Impossible de charger les comptes.</p>
    <p v-else-if="rows.length === 0" class="state">Aucun compte.</p>

    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Demandé le</th>
            <th>Organisation</th>
            <th>Contact</th>
            <th>Registre</th>
            <th>Statut</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id" class="row" tabindex="0" @click="open(row.id)" @keydown.enter="open(row.id)">
            <td>{{ formatDateTime(row.createdAt) }}</td>
            <td>
              <span class="strong">{{ row.legalName }}</span>
              <span class="sub">{{ organisationTypeLabel(row.type) }} · {{ row.siret }}</span>
            </td>
            <td>
              <span>{{ memberName(row) }}</span>
              <span class="sub">{{ row.member?.email }}</span>
            </td>
            <td><AdminStatusTag v-bind="registryCheckLabel(row.registryCheck)" /></td>
            <td><AdminStatusTag v-bind="organisationStatus(row.status)" /></td>
          </tr>
        </tbody>
      </table>
    </div>

    <nav v-if="pagination && pagination.totalPages > 1" class="pager">
      <button class="btn btn-ghost" :disabled="page <= 1" @click="page--">Précédent</button>
      <span class="pager__info">Page {{ pagination.page }} / {{ pagination.totalPages }}</span>
      <button class="btn btn-ghost" :disabled="!pagination.hasMore" @click="page++">Suivant</button>
    </nav>

    <AdminDrawer v-if="drawerOpen" :label="selected?.legalName ?? 'Compte professionnel'" @close="close">
      <p v-if="drawerLoading" class="state">Chargement…</p>
      <p v-else-if="!selected" class="error" role="alert">{{ actionError }}</p>

      <template v-else>
        <p class="eyebrow">{{ organisationTypeLabel(selected.type) }}</p>
        <h2 class="drawer-title">{{ selected.legalName }}</h2>
        <p class="drawer-sub">
          <AdminStatusTag v-bind="organisationStatus(selected.status)" />
        </p>

        <dl class="meta">
          <div>
            <dt>SIRET</dt>
            <dd>
              <a
                :href="`https://annuaire-entreprises.data.gouv.fr/etablissement/${selected.siret}`"
                target="_blank"
                rel="noopener noreferrer"
              >{{ selected.siret }} ↗</a>
            </dd>
          </div>
          <div><dt>Contact</dt><dd>{{ memberName(selected) }}<br /><span class="sub">{{ selected.member?.email }}</span></dd></div>
          <div><dt>Demandé le</dt><dd>{{ formatDateTime(selected.createdAt) }}</dd></div>
          <div v-if="selected.reviewedAt"><dt>Dernière décision</dt><dd>{{ formatDateTime(selected.reviewedAt) }}</dd></div>
        </dl>

        <section class="block">
          <h3 class="block__h">Registre des entreprises</h3>
          <p><AdminStatusTag v-bind="registryCheckLabel(selected.registryCheck)" /></p>
          <dl v-if="selected.registrySnapshot" class="meta">
            <div><dt>Nom au registre</dt><dd>{{ selected.registrySnapshot.legalName }}</dd></div>
            <div v-if="selected.registrySnapshot.address"><dt>Adresse</dt><dd>{{ selected.registrySnapshot.address }}</dd></div>
            <div v-if="selected.registrySnapshot.activityCode"><dt>Code NAF</dt><dd>{{ selected.registrySnapshot.activityCode }}</dd></div>
            <div v-if="selected.registrySnapshot.legalNature"><dt>Nature juridique</dt><dd>{{ selected.registrySnapshot.legalNature }}</dd></div>
          </dl>
          <p class="hint">Consulté le {{ formatDateTime(selected.registryCheckedAt) }}, au moment de la demande.</p>
        </section>

        <p v-if="selected.reviewReason" class="reason">Motif : {{ selected.reviewReason }}</p>

        <section v-if="selected.status !== 'rejected'" class="block">
          <h3 class="block__h">Conditions commerciales</h3>
          <label class="field">
            <span>Remise sur le prix public HT (%)</span>
            <input v-model.number="terms.discountPct" name="discountPct" type="number" min="0" max="100" step="0.01" class="ctl" />
          </label>
          <label class="check">
            <input v-model="terms.net30Allowed" name="net30Allowed" type="checkbox" />
            <span>Paiement à 30 jours autorisé</span>
          </label>
          <label class="check">
            <input v-model="terms.showPrices" name="showPrices" type="checkbox" />
            <span>Afficher ses prix nets en boutique</span>
          </label>
          <button v-if="selected.status !== 'pending'" type="button" class="btn btn-ghost save-terms" :disabled="acting" @click="saveTerms">
            Enregistrer les conditions
          </button>
        </section>

        <p v-if="actionError" class="error" role="alert">{{ actionError }}</p>

        <form v-if="mode !== 'view'" class="reason-form" novalidate @submit.prevent="confirmWithReason">
          <label class="field">
            <span>{{ mode === "reject" ? "Motif du refus" : "Motif de la suspension" }} (envoyé au client)</span>
            <textarea v-model="reason" name="reason" class="ctl" rows="3" maxlength="1000" />
          </label>
          <div class="actions">
            <button type="submit" class="btn btn-primary danger-solid" :disabled="acting">
              {{ mode === "reject" ? "Confirmer le refus" : "Confirmer la suspension" }}
            </button>
            <button type="button" class="btn btn-ghost" :disabled="acting" @click="mode = 'view'">Annuler</button>
          </div>
        </form>

        <div v-else class="actions">
          <template v-if="selected.status === 'pending'">
            <button type="button" class="btn btn-primary approve" :disabled="acting" @click="approve">Valider</button>
            <button type="button" class="btn btn-ghost danger reject" :disabled="acting" @click="askReason('reject')">Refuser</button>
          </template>
          <button
            v-else-if="selected.status === 'approved'"
            type="button"
            class="btn btn-ghost danger suspend"
            :disabled="acting"
            @click="askReason('suspend')"
          >
            Suspendre
          </button>
          <button v-else-if="selected.status === 'suspended'" type="button" class="btn btn-primary reinstate" :disabled="acting" @click="reinstate">
            Rétablir
          </button>
        </div>
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
  font-size: var(--fs-sm);
  min-width: 720px;
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
  transition: background 0.15s var(--ease);
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
.state--error {
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
.meta a {
  color: var(--brass);
}
.block {
  margin: 1.4rem 0;
}
.block__h {
  font-size: var(--fs-md);
  margin: 0 0 0.8rem;
}
.reason {
  padding: 0.7rem 0.9rem;
  border-left: 2px solid var(--danger);
  color: var(--paper-dim);
}
.field {
  display: block;
  margin-bottom: 1rem;
}
.field span {
  display: block;
  font-size: var(--fs-xs);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--paper-faint);
  margin-bottom: 0.4rem;
}
.check {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.8rem;
  font-size: var(--fs-sm);
}
.ctl {
  width: 100%;
  padding: 0.6rem 0.7rem;
  background: var(--ink);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper);
  font-family: inherit;
  font-size: var(--fs-base);
}
.ctl:focus {
  outline: none;
  border-color: var(--brass);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.7rem;
  margin-top: 1rem;
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
  font-size: var(--fs-sm);
  margin: 1rem 0 0;
}
.hint {
  color: var(--paper-faint);
  font-size: var(--fs-sm);
  margin-top: 0.6rem;
}
</style>
