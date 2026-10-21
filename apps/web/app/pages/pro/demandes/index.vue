<script setup lang="ts">
import type { QuoteRequestSummary } from "~/types/quote"
import { formatDate } from "~/utils/format"
import { quoteRequestStatus } from "~/utils/organisation"

// Story 12.8c — the organisation's quote requests and where each stands.
definePageMeta({ middleware: "auth" })
useHead({ title: "Mes demandes de devis — SCS Firearms" })

const access = useProAccess()
const { listRequests } = useQuotes()

const ready = ref(false)
const requests = ref<QuoteRequestSummary[] | null>(null)
const error = ref(false)

onMounted(async () => {
  await access.load()
  ready.value = true
  if (!access.isApprovedPro.value) return
  try {
    requests.value = await listRequests()
  } catch {
    error.value = true
  }
})
</script>

<template>
  <div class="pro">
    <section class="container pro__inner">
      <AppBreadcrumbs :structured="false" :items="[{ name: 'Mon compte', to: '/compte' }, { name: 'Mes demandes de devis' }]" />
      <h1 class="pro__title">Mes demandes de devis</h1>

      <p v-if="!ready" class="state">Chargement…</p>
      <ProAccessNotice v-else-if="!access.isApprovedPro.value" :organisation="access.organisation.value" />
      <p v-else-if="error" class="state">Impossible de charger vos demandes. Veuillez réessayer.</p>
      <p v-else-if="!requests" class="state">Chargement…</p>
      <p v-else-if="requests.length === 0" class="state">
        Vous n'avez pas encore envoyé de demande.
        <NuxtLink to="/pro/catalogue" class="link">Parcourir le catalogue professionnel</NuxtLink>
      </p>

      <ul v-else class="requests" role="list">
        <li v-for="request in requests" :key="request.id" class="request">
          <NuxtLink :to="`/pro/demandes/${request.id}`" class="request__link">
            <span class="request__main">
              <span class="request__number">{{ request.number }}</span>
              <span class="request__meta">
                {{ formatDate(request.createdAt) }} · {{ request.lineCount }} article{{ request.lineCount > 1 ? "s" : "" }}
              </span>
            </span>
            <AdminStatusTag v-bind="quoteRequestStatus(request.status)" />
          </NuxtLink>
        </li>
      </ul>
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
.pro__title {
  font-size: var(--fs-2xl);
  margin: 0.4rem 0 1.5rem;
}
.state {
  color: var(--paper-dim);
  padding: 1rem 0 3rem;
}
.link {
  color: var(--brass);
}
.requests {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}
.request__link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.2rem;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  background: var(--ink-soft);
  color: inherit;
  transition: border-color 0.2s var(--ease);
}
.request__link:hover {
  border-color: var(--brass);
}
.request__number {
  display: block;
  font-weight: var(--fw-semibold);
}
.request__meta {
  display: block;
  margin-top: 0.2rem;
  font-size: var(--fs-sm);
  color: var(--paper-dim);
}
</style>
