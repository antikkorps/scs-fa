<script setup lang="ts">
import type { AdminUserRow } from "~/types/admin"
import { formatDate } from "~/utils/format"
import { apiErrorCode, apiErrorField } from "~/utils/formErrors"

// A customer lost their phone and their recovery codes: SCS finds the account
// by name or e-mail and resets its authenticator app (story 12.8e). A search,
// never a full customer list.
definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Clients — Administration SCS" })

const MIN_SEARCH_LENGTH = 3

const api = useApi()
const search = ref("")
const rows = ref<AdminUserRow[] | null>(null)
const searching = ref(false)
const resetting = ref<string | null>(null)
const notice = ref("")
const error = ref("")

const ERROR_MESSAGES: Record<string, string> = {
  OwnAccount: "Votre propre double authentification se réinitialise par un autre administrateur.",
  NotFound: "Ce compte n'existe plus.",
}

function errorMessage(err: unknown, fallback: string): string {
  const code = apiErrorCode(err)
  return (code && ERROR_MESSAGES[code]) || apiErrorField<string>(err, "message") || fallback
}

const fullName = (row: AdminUserRow) => [row.firstname, row.lastname].filter(Boolean).join(" ") || "—"

function accountKind(row: AdminUserRow): string {
  if (row.role === "admin") return "Administrateur"
  if (row.isPro) return "Professionnel"
  return "Particulier"
}

async function runSearch() {
  const query = search.value.trim()
  notice.value = ""
  error.value = ""
  if (query.length < MIN_SEARCH_LENGTH) {
    rows.value = null
    error.value = `Saisissez au moins ${MIN_SEARCH_LENGTH} caractères.`
    return
  }
  searching.value = true
  try {
    const result = await api<{ data: AdminUserRow[] }>(`/admin/users?q=${encodeURIComponent(query)}`)
    rows.value = result.data
  } catch (err) {
    error.value = errorMessage(err, "La recherche a échoué.")
  } finally {
    searching.value = false
  }
}

async function resetTotp(row: AdminUserRow) {
  if (!confirm(`Réinitialiser la double authentification de ${row.email} ?`)) return
  notice.value = ""
  error.value = ""
  resetting.value = row.id
  try {
    await api(`/admin/users/${row.id}/totp/reset`, { method: "POST" })
    row.totpEnabled = false
    notice.value =
      row.role === "admin"
        ? `Double authentification de ${row.email} réinitialisée : elle sera à reconfigurer à la prochaine connexion.`
        : `Double authentification de ${row.email} réinitialisée : le client pourra en configurer une nouvelle depuis son compte.`
  } catch (err) {
    error.value = errorMessage(err, "La réinitialisation a échoué.")
  } finally {
    resetting.value = null
  }
}
</script>

<template>
  <div>
    <header class="head">
      <p class="eyebrow">Ventes</p>
      <h1>Clients</h1>
      <p class="intro">
        Retrouvez un compte par son nom ou son e-mail, par exemple pour réinitialiser sa double authentification
        quand le client a perdu son téléphone et ses codes de secours. L'action est journalisée.
      </p>
    </header>

    <form class="filters" role="search" @submit.prevent="runSearch">
      <input
        v-model="search"
        class="ctl"
        type="search"
        aria-label="Nom ou e-mail"
        placeholder="Nom ou e-mail…"
        maxlength="255"
      />
      <button type="submit" class="btn btn-primary" :disabled="searching">Rechercher</button>
    </form>

    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <p v-if="searching" class="state">Recherche…</p>
    <p v-else-if="rows && rows.length === 0" class="state">Aucun compte ne correspond.</p>
    <div v-else-if="rows" class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Compte</th>
            <th>Type</th>
            <th>Inscrit le</th>
            <th>Double authentification</th>
            <th><span class="sr-only">Action</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td>
              <span class="strong">{{ fullName(row) }}</span>
              <span class="sub">{{ row.email }}</span>
            </td>
            <td>{{ accountKind(row) }}</td>
            <td>{{ formatDate(row.createdAt) }}</td>
            <td>
              <AdminStatusTag v-if="row.totpEnabled" label="Activée" severity="ok" />
              <AdminStatusTag v-else label="Désactivée" severity="muted" />
            </td>
            <td class="action">
              <button
                v-if="row.totpEnabled"
                type="button"
                class="btn btn-ghost reset-totp"
                :disabled="resetting !== null"
                @click="resetTotp(row)"
              >
                Réinitialiser
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
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
.intro {
  color: var(--paper-dim);
  font-size: var(--fs-sm);
  max-width: 60ch;
  margin-top: 0.6rem;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-bottom: 1.4rem;
}
.ctl {
  flex: 1 1 240px;
  max-width: 420px;
  padding: 0.6rem 0.8rem;
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper);
  font-family: inherit;
  font-size: var(--fs-sm);
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
  font-size: var(--fs-sm);
  min-width: 640px;
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
  vertical-align: middle;
}
.table tr:last-child td {
  border-bottom: none;
}
.action {
  text-align: right;
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
.state {
  color: var(--paper-dim);
  padding: 2rem 0;
}
.notice {
  color: var(--brass);
  font-size: var(--fs-sm);
  margin-bottom: 1rem;
}
.error {
  color: var(--danger);
  font-size: var(--fs-sm);
  margin-bottom: 1rem;
}
</style>
