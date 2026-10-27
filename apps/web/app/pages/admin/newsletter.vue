<script setup lang="ts">
import { NEWSLETTER_SEGMENTS, type NewsletterSegment } from "@armurier/shared"
import type {
  AdminNewsletterContact,
  AdminNewsletterSubscription,
  AdminNewsletterSummary,
  Pagination,
} from "~/types/admin"
import { formatDate, formatNumber, plural } from "~/utils/format"
import { NEWSLETTER_STATUS_OPTIONS, newsletterStatus } from "~/utils/status"

// Who is subscribed to which segment, with the proof of each consent. Read-only:
// letters are written and sent from Brevo, and a subscriber leaves through the
// unsubscribe link of every letter.
definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Newsletter — Administration SCS" })

const SEGMENT_LABELS: Record<NewsletterSegment, string> = {
  armurerie: "Armurerie",
  collection: "Armes de collection",
  gun_art: "Gun Art",
}

const api = useApi()

// Typed values only reach the query once the form is submitted.
const search = ref("")
const segmentFilter = ref("")
const statusFilter = ref("")
const applied = reactive({ search: "", segment: "", status: "" })
const page = ref(1)

const query = computed(() => {
  const params = new URLSearchParams()
  if (applied.segment) params.set("segment", applied.segment)
  if (applied.status) params.set("status", applied.status)
  if (applied.search) params.set("search", applied.search)
  params.set("page", String(page.value))
  params.set("limit", "20")
  return params.toString()
})

const { data: summary } = await useAsyncData(
  "admin-newsletter-summary",
  () => api<{ data: AdminNewsletterSummary }>("/admin/newsletter/summary"),
  { server: false },
)

// The key follows the query, so a new filter or page fetches its own result.
const { data, pending, error } = await useAsyncData(
  () => `admin-newsletter-contacts-${query.value}`,
  () => api<{ data: AdminNewsletterContact[]; pagination: Pagination }>(`/admin/newsletter?${query.value}`),
  { server: false },
)

const counts = computed(() => summary.value?.data)
const contacts = computed(() => data.value?.data ?? [])
const pagination = computed(() => data.value?.pagination)

function applyFilters() {
  applied.search = search.value.trim()
  applied.segment = segmentFilter.value
  applied.status = statusFilter.value
  page.value = 1
}

function resetFilters() {
  search.value = ""
  segmentFilter.value = ""
  statusFilter.value = ""
  applyFilters()
}

function go(delta: number) {
  const next = page.value + delta
  if (next < 1 || (pagination.value && next > pagination.value.totalPages)) return
  page.value = next
}

/** The date that matters for the current status. */
function statusDate(subscription: AdminNewsletterSubscription): string {
  if (subscription.status === "confirmed") return `depuis le ${formatDate(subscription.confirmedAt)}`
  if (subscription.status === "unsubscribed") return `le ${formatDate(subscription.unsubscribedAt)}`
  return `demandé le ${formatDate(subscription.requestedAt)}`
}

function syncWarning(awaiting: number): string {
  return awaiting > 1
    ? `${formatNumber(awaiting)} abonnements confirmés ne sont pas encore transmis à Brevo : ils ne recevront pas les lettres tant que la synchronisation n'a pas abouti.`
    : "1 abonnement confirmé n'est pas encore transmis à Brevo : il ne recevra pas les lettres tant que la synchronisation n'a pas abouti."
}

function consentProof(subscription: AdminNewsletterSubscription): string {
  return [subscription.consentSource, subscription.consentIp].filter(Boolean).join(" · ")
}
</script>

<template>
  <div>
    <header class="head">
      <p class="eyebrow">Contenu</p>
      <h1>Newsletter</h1>
      <p class="intro">
        Abonnés par univers, avec la preuve de chaque consentement. Seuls les abonnements confirmés reçoivent les
        lettres, qui se rédigent et s'envoient depuis Brevo ; un abonné se désinscrit par le lien présent dans chaque
        envoi.
      </p>
    </header>

    <section v-if="counts" class="summary" aria-label="Abonnés par univers">
      <div v-for="segment in NEWSLETTER_SEGMENTS" :key="segment" class="segment">
        <p class="segment__label">{{ SEGMENT_LABELS[segment] }}</p>
        <p class="segment__value">{{ formatNumber(counts.segments[segment].confirmed) }}</p>
        <p class="segment__sub">
          {{ counts.segments[segment].confirmed > 1 ? "abonnés" : "abonné" }} ·
          {{ formatNumber(counts.segments[segment].pending) }} à confirmer ·
          {{ plural(counts.segments[segment].unsubscribed, "désabonné") }}
        </p>
      </div>
    </section>
    <p v-if="counts" class="contacts-count">{{ plural(counts.contacts, "adresse enregistrée", "adresses enregistrées") }}.</p>
    <p v-if="counts && counts.awaitingSync > 0" class="sync-warning" role="status">{{ syncWarning(counts.awaitingSync) }}</p>

    <form class="filters" role="search" @submit.prevent="applyFilters">
      <input
        v-model="search"
        class="ctl"
        type="search"
        aria-label="Adresse e-mail"
        placeholder="Adresse e-mail…"
        maxlength="255"
      />
      <select v-model="segmentFilter" name="segment" class="ctl ctl--select" aria-label="Univers">
        <option value="">Tous les univers</option>
        <option v-for="segment in NEWSLETTER_SEGMENTS" :key="segment" :value="segment">
          {{ SEGMENT_LABELS[segment] }}
        </option>
      </select>
      <select v-model="statusFilter" name="status" class="ctl ctl--select" aria-label="Statut">
        <option value="">Tous les statuts</option>
        <option v-for="option in NEWSLETTER_STATUS_OPTIONS" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
      <button type="submit" class="btn btn-ghost">Filtrer</button>
      <button type="button" class="btn btn-ghost" @click="resetFilters">Réinitialiser</button>
    </form>

    <p v-if="pending" class="state">Chargement…</p>
    <p v-else-if="error" class="state state--error" role="alert">Impossible de charger les abonnés.</p>
    <p v-else-if="contacts.length === 0" class="state">Aucun abonné ne correspond.</p>
    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Adresse</th>
            <th>Abonnements</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="contact in contacts" :key="contact.id">
            <td>
              <span class="strong">{{ contact.email }}</span>
              <span class="sub">Inscription le {{ formatDate(contact.createdAt) }}</span>
            </td>
            <td>
              <ul class="subscriptions">
                <li v-for="subscription in contact.subscriptions" :key="subscription.segment" class="subscription">
                  <span class="subscription__segment">{{ SEGMENT_LABELS[subscription.segment] }}</span>
                  <AdminStatusTag
                    :label="newsletterStatus(subscription.status).label"
                    :severity="newsletterStatus(subscription.status).severity"
                  />
                  <span class="sub">{{ statusDate(subscription) }}</span>
                  <span v-if="subscription.status === 'confirmed' && !subscription.synced" class="not-synced">
                    pas encore chez Brevo
                  </span>
                  <span v-if="consentProof(subscription)" class="sub proof">
                    Consentement : {{ consentProof(subscription) }}
                  </span>
                </li>
              </ul>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <nav v-if="pagination && pagination.totalPages > 1" class="pager" aria-label="Pagination">
      <button type="button" class="btn btn-ghost" :disabled="page <= 1" @click="go(-1)">Précédent</button>
      <span class="pager__info">
        Page {{ pagination.page }} / {{ pagination.totalPages }} · {{ plural(pagination.total, "contact") }}
      </span>
      <button type="button" class="btn btn-ghost pager-next" :disabled="!pagination.hasMore" @click="go(1)">
        Suivant
      </button>
    </nav>
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
.summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.8rem;
}
.segment {
  padding: 1rem 1.1rem;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  background: var(--ink-soft);
}
.segment p {
  margin: 0;
}
.segment__label {
  font-size: var(--fs-xs);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--paper-faint);
}
.segment__value {
  font-size: var(--fs-2xl);
  font-weight: var(--fw-semibold);
  color: var(--brass);
  margin-top: 0.3rem;
}
.segment__sub {
  font-size: var(--fs-xs);
  color: var(--paper-dim);
  margin-top: 0.2rem;
}
.contacts-count {
  color: var(--paper-dim);
  font-size: var(--fs-sm);
  margin: 0.8rem 0 0;
}
.sync-warning {
  color: #e0b15f;
  font-size: var(--fs-sm);
  margin-top: 0.6rem;
  max-width: 70ch;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin: 1.4rem 0;
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
.ctl--select {
  flex: 0 1 200px;
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
  min-width: 560px;
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
.table tr:last-child td {
  border-bottom: none;
}
.strong {
  display: block;
  font-weight: var(--fw-semibold);
  overflow-wrap: anywhere;
}
.sub {
  display: block;
  color: var(--paper-faint);
  font-size: var(--fs-xs);
  margin-top: 0.15rem;
}
.subscriptions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.7rem;
}
.subscription {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.2rem 0.6rem;
}
.subscription__segment {
  font-weight: var(--fw-semibold);
}
.subscription .sub {
  margin-top: 0;
}
.proof {
  flex-basis: 100%;
}
.not-synced {
  color: #e0b15f;
  font-size: var(--fs-xs);
}
/* Phone: one block per contact, so the subscriptions are never cut off. */
@media (max-width: 640px) {
  .table {
    min-width: 0;
  }
  .table thead {
    display: none;
  }
  .table tr,
  .table td {
    display: block;
  }
  .table td + td {
    padding-top: 0;
  }
  .table tr + tr {
    border-top: 1px solid var(--ink-line);
  }
  .table td {
    border-bottom: none;
  }
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
</style>
