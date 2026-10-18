<script setup lang="ts">
import { formatDateTime } from "~/utils/format"
import { historyActorLabel, historyErrorLabel, historyEventLabel, type OrderHistoryEvent } from "~/utils/history"

// Story 12.7b — what happened to an order, oldest first: for Fred and Stéphane
// when a customer calls. The request id leads Franck to the technical logs.
// Mounted only while its tab is open, so each visit loads it afresh.

const props = defineProps<{ orderId: string }>()
const api = useApi()

const events = ref<OrderHistoryEvent[]>([])
const loading = ref(true)
const failed = ref(false)

async function load() {
  loading.value = true
  failed.value = false
  try {
    const { data } = await api<{ data: OrderHistoryEvent[] }>(`/admin/orders/${props.orderId}/history`)
    events.value = data
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="panel">
    <h2 class="panel__title">Historique</h2>
    <p v-if="loading" class="state">Chargement…</p>
    <p v-else-if="failed" class="state state--error" role="alert">Impossible de charger l'historique.</p>
    <p v-else-if="!events.length" class="state">Aucun événement enregistré pour cette commande.</p>
    <ol v-else class="timeline">
      <li v-for="item in events" :key="item.id" class="event" :class="{ 'event--failure': item.result === 'failure' }">
        <p class="event__head">
          <span class="event__label">{{ historyEventLabel(item) }}</span>
          <span v-if="item.result === 'failure'" class="event__flag">Échec</span>
        </p>
        <p v-if="item.error" class="event__error">{{ historyErrorLabel(item.error) }}</p>
        <p class="event__meta">
          <time :datetime="item.createdAt">{{ formatDateTime(item.createdAt) }}</time>
          · {{ historyActorLabel(item.actor) }}
          <template v-if="item.reqId">
            · <span class="event__req" title="Identifiant de requête, pour retrouver les logs techniques">{{ item.reqId }}</span>
          </template>
        </p>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.panel {
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  padding: 1.3rem 1.4rem;
}
.panel__title {
  font-size: var(--fs-md);
  margin-bottom: 1rem;
}
.state {
  color: var(--paper-dim);
  margin: 0;
}
.state--error {
  color: var(--danger);
}
.timeline {
  list-style: none;
  margin: 0;
  padding: 0;
}
.event {
  position: relative;
  padding: 0 0 1rem 1.2rem;
  border-left: 1px solid var(--ink-line);
}
.event:last-child {
  padding-bottom: 0;
}
.event::before {
  content: "";
  position: absolute;
  left: -0.3rem;
  top: 0.4rem;
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 50%;
  background: var(--brass);
}
.event--failure::before {
  background: var(--danger);
}
.event p {
  margin: 0;
}
.event__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem;
}
.event__label {
  font-weight: var(--fw-medium);
}
.event__flag {
  color: var(--danger);
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
}
.event__error {
  color: var(--danger);
  font-size: var(--fs-sm);
  margin-top: 0.2rem;
}
.event__meta {
  color: var(--paper-faint);
  font-size: var(--fs-sm);
  margin-top: 0.2rem;
  overflow-wrap: anywhere;
}
.event__req {
  font-family: ui-monospace, monospace;
}
</style>
