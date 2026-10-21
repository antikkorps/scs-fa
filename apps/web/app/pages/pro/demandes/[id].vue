<script setup lang="ts">
import { CANCELLABLE_QUOTE_STATUSES, type QuoteRequestStatus } from "@armurier/shared"
import type { QuoteRequestDetail } from "~/types/quote"
import { formatDateTime } from "~/utils/format"
import { quoteRequestStatus } from "~/utils/organisation"
import { legalCategoryLabel } from "~/utils/product"

// Story 12.8c — one quote request: its lines as asked, and its cancellation
// while SCS has not started on it.
definePageMeta({ middleware: "auth" })

const route = useRoute()
const id = String(route.params.id)
const justSent = route.query.envoyee === "1"
const access = useProAccess()
const { getRequest, cancelRequest } = useQuotes()

const ready = ref(false)
const request = ref<QuoteRequestDetail | null>(null)
const notFound = ref(false)
const loadError = ref(false)
const cancelling = ref(false)
const cancelError = ref("")

useHead({ title: () => `Demande ${request.value?.number ?? ""} — SCS Firearms` })

onMounted(async () => {
  await access.load()
  ready.value = true
  if (!access.isApprovedPro.value) return
  try {
    request.value = await getRequest(id)
  } catch (err) {
    if (authErrorStatus(err) === 404) notFound.value = true
    else loadError.value = true
  }
})

const cancellable = computed(() =>
  (CANCELLABLE_QUOTE_STATUSES as readonly QuoteRequestStatus[]).includes(request.value?.status ?? "cancelled"),
)

async function cancel() {
  if (!request.value || !confirm(`Annuler la demande ${request.value.number} ?`)) return
  cancelling.value = true
  cancelError.value = ""
  try {
    request.value = await cancelRequest(request.value.id)
  } catch (err) {
    cancelError.value =
      apiErrorCode(err) === "NotCancellable"
        ? "Notre équipe a déjà commencé à l'étudier : écrivez-nous pour l'arrêter."
        : "L'annulation a échoué. Réessayez."
  } finally {
    cancelling.value = false
  }
}
</script>

<template>
  <div class="pro">
    <section class="container pro__inner">
      <AppBreadcrumbs
        :structured="false"
        :items="[{ name: 'Mes demandes de devis', to: '/pro/demandes' }, { name: request?.number ?? 'Demande' }]"
      />

      <p v-if="!ready" class="state">Chargement…</p>
      <ProAccessNotice v-else-if="!access.isApprovedPro.value" :organisation="access.organisation.value" />
      <p v-else-if="notFound" class="state">Demande introuvable.</p>
      <p v-else-if="loadError" class="state">Impossible de charger cette demande. Veuillez réessayer.</p>
      <p v-else-if="!request" class="state">Chargement…</p>

      <template v-else>
        <p v-if="justSent" class="sent" role="status">
          Demande envoyée. Notre équipe l'étudie et vous envoie un devis par e-mail.
        </p>
        <header class="head">
          <h1 class="pro__title">Demande {{ request.number }}</h1>
          <AdminStatusTag v-bind="quoteRequestStatus(request.status)" />
        </header>
        <p class="meta">Envoyée le {{ formatDateTime(request.createdAt) }}</p>

        <ul class="lines" role="list">
          <li v-for="line in request.items" :key="line.id" class="line">
            <span class="line__main">
              <NuxtLink v-if="line.productSlug" :to="`/pro/catalogue/${line.productSlug}`" class="line__name">
                {{ line.productName }}
              </NuxtLink>
              <span v-else class="line__name">{{ line.productName }}</span>
              <span class="line__meta">
                <template v-if="line.variantLabel">{{ line.variantLabel }} · </template>{{ line.productSku }} ·
                {{ legalCategoryLabel(line.legalCategory) }}
              </span>
            </span>
            <span class="line__qty">× {{ line.qty }}</span>
          </li>
        </ul>

        <section v-if="request.message" class="message">
          <h2 class="message__h">Votre message</h2>
          <p>{{ request.message }}</p>
        </section>

        <p v-if="cancelError" class="err" role="alert">{{ cancelError }}</p>
        <button v-if="cancellable" type="button" class="btn btn-ghost cancel" :disabled="cancelling" @click="cancel">
          {{ cancelling ? "Annulation…" : "Annuler cette demande" }}
        </button>
      </template>
    </section>
  </div>
</template>

<style scoped>
.pro {
  padding-top: clamp(1.5rem, 4vw, 2.5rem);
}
.pro__inner {
  max-width: 820px;
  padding-bottom: 4rem;
}
.state {
  color: var(--paper-dim);
  padding: 1rem 0 3rem;
}
.sent {
  padding: 0.9rem 1.1rem;
  border: 1px solid var(--brass);
  border-radius: var(--radius);
  color: var(--brass);
  margin: 1rem 0 1.5rem;
}
.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.8rem;
}
.pro__title {
  font-size: var(--fs-2xl);
  margin: 0.4rem 0;
}
.meta {
  color: var(--paper-dim);
  margin: 0 0 1.5rem;
}
.lines {
  list-style: none;
  margin: 0 0 1.5rem;
  padding: 0;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
}
.line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem 1.2rem;
  border-bottom: 1px solid var(--ink-line);
}
.line:last-child {
  border-bottom: none;
}
.line__name {
  display: block;
  font-weight: var(--fw-semibold);
  color: var(--paper);
}
.line__meta {
  display: block;
  margin-top: 0.2rem;
  font-size: var(--fs-sm);
  color: var(--paper-dim);
}
.line__qty {
  white-space: nowrap;
  font-weight: var(--fw-semibold);
}
.message {
  margin-bottom: 1.5rem;
}
.message__h {
  font-size: var(--fs-md);
  margin: 0 0 0.4rem;
}
.message p {
  margin: 0;
  color: var(--paper-dim);
  white-space: pre-line;
}
.err {
  color: var(--danger);
}
</style>
