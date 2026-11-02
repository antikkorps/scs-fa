<script setup lang="ts">
import { CONTACT_SUBJECT_LABELS, type ContactStatus, type ContactSubject } from "@armurier/shared"
import { formatDateTime } from "~/utils/format"

definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Messages — Administration SCS" })

// Audit 2026-11-01 (I8b) — what visitors sent through the contact form. The
// reply goes from the admin's own mailbox; here a message is marked handled
// (journaled), and it is deleted a year later.
interface ContactMessage {
  id: string
  name: string
  email: string
  phone: string | null
  subject: ContactSubject
  orderReference: string | null
  message: string
  status: ContactStatus
  handledAt: string | null
  createdAt: string
}

const TABS: { status: ContactStatus; label: string }[] = [
  { status: "new", label: "À traiter" },
  { status: "handled", label: "Traités" },
]

const api = useApi()
const status = ref<ContactStatus>("new")
const openId = ref<string | null>(null)
const actionError = ref("")

const messages = ref<ContactMessage[]>([])
const pending = ref(true)
const error = ref(false)

async function load() {
  pending.value = true
  error.value = false
  try {
    messages.value = (
      await api<{ data: ContactMessage[] }>("/admin/contact-messages", { query: { status: status.value } })
    ).data
  } catch {
    error.value = true
  } finally {
    pending.value = false
  }
}
onMounted(load)

async function showTab(next: ContactStatus) {
  if (status.value === next) return
  status.value = next
  openId.value = null
  await load()
}

function subjectLine(message: ContactMessage): string {
  const subject = CONTACT_SUBJECT_LABELS[message.subject]
  return message.orderReference ? `${subject} — ${message.orderReference}` : subject
}

function replyHref(message: ContactMessage): string {
  return `mailto:${message.email}?subject=${encodeURIComponent(`Re: ${subjectLine(message)}`)}`
}

async function setStatus(message: ContactMessage, next: ContactStatus) {
  actionError.value = ""
  try {
    await api(`/admin/contact-messages/${message.id}`, { method: "PATCH", body: { status: next } })
    openId.value = null
    await load()
  } catch {
    actionError.value = "La mise à jour a échoué. Réessayez."
  }
}
</script>

<template>
  <div>
    <header class="head">
      <p class="eyebrow">Ventes</p>
      <h1>Messages</h1>
      <p class="intro">
        Les messages envoyés depuis la page Contact. Répondez depuis votre messagerie, puis marquez le message comme
        traité ; il est supprimé un an plus tard.
      </p>
    </header>

    <div class="tabs" role="tablist">
      <button
        v-for="tab in TABS"
        :key="tab.status"
        type="button"
        role="tab"
        class="tab"
        :class="{ 'tab--on': status === tab.status }"
        :aria-selected="status === tab.status"
        :data-status="tab.status"
        @click="showTab(tab.status)"
      >
        {{ tab.label }}
      </button>
    </div>

    <p v-if="pending" class="state">Chargement…</p>
    <p v-else-if="error" class="state">Impossible de charger les messages.</p>
    <p v-else-if="messages.length === 0" class="state">Aucun message.</p>

    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Reçu</th>
            <th>De</th>
            <th>Sujet</th>
            <th><span class="sr-only">Ouvrir</span></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="message in messages" :key="message.id">
            <tr :class="{ 'row--on': openId === message.id }">
              <td class="cell-date">{{ formatDateTime(message.createdAt) }}</td>
              <td>
                <span class="strong">{{ message.name }}</span>
                <span class="sub cell-break">{{ message.email }}</span>
              </td>
              <td>{{ subjectLine(message) }}</td>
              <td class="cell--actions">
                <button
                  type="button"
                  class="btn btn-ghost open"
                  :aria-expanded="openId === message.id"
                  @click="openId = openId === message.id ? null : message.id"
                >
                  {{ openId === message.id ? "Fermer" : "Lire" }}
                </button>
              </td>
            </tr>
            <tr v-if="openId === message.id">
              <td colspan="4">
                <div class="detail">
                  <p v-if="message.phone" class="detail__meta">Téléphone : {{ message.phone }}</p>
                  <p class="detail__text">{{ message.message }}</p>
                  <div class="detail__actions">
                    <a class="btn btn-primary reply" :href="replyHref(message)">Répondre par e-mail</a>
                    <button
                      v-if="message.status === 'new'"
                      type="button"
                      class="btn btn-ghost handle"
                      @click="setStatus(message, 'handled')"
                    >
                      Marquer comme traité
                    </button>
                    <button v-else type="button" class="btn btn-ghost reopen" @click="setStatus(message, 'new')">
                      Remettre à traiter
                    </button>
                  </div>
                  <p v-if="actionError" class="err" role="alert">{{ actionError }}</p>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.head {
  margin-bottom: 1.5rem;
  max-width: 46rem;
}
.eyebrow {
  margin: 0;
  font-size: var(--fs-xs);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--paper-faint);
}
h1 {
  margin: 0.3rem 0 0.6rem;
  font-size: var(--fs-2xl);
}
.intro,
.state {
  margin: 0;
  color: var(--paper-dim);
  line-height: var(--lh-normal);
}
.tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.tab {
  background: none;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper-dim);
  padding: 0.45rem 0.9rem;
  font: inherit;
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
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--ink-line);
  vertical-align: middle;
}
.row--on {
  background: rgba(200, 163, 91, 0.07);
}
.strong {
  display: block;
  font-weight: var(--fw-semibold);
}
.sub {
  display: block;
  color: var(--paper-faint);
}
.cell--actions {
  text-align: right;
}
.detail {
  display: grid;
  gap: 0.8rem;
  max-width: 46rem;
}
.detail__meta {
  margin: 0;
  color: var(--paper-dim);
}
.detail__text {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: var(--lh-normal);
}
.detail__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}
.err {
  margin: 0;
  color: var(--danger);
}
</style>
