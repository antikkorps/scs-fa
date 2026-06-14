<script setup lang="ts">
import type { MetricsResult } from "~/types/admin"
import { formatEuros } from "~/utils/format"

definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Métriques — Administration SCS" })

const api = useApi()

const PRESETS = [
  { key: "7", label: "7 jours", days: 7 },
  { key: "30", label: "30 jours", days: 30 },
  { key: "90", label: "90 jours", days: 90 },
] as const
const preset = ref<(typeof PRESETS)[number]["key"]>("30")

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

const query = computed(() => {
  const days = PRESETS.find((p) => p.key === preset.value)?.days ?? 30
  return `from=${isoDaysAgo(days)}&to=${new Date().toISOString().slice(0, 10)}`
})

const { data, pending, error } = await useAsyncData(
  "admin-metrics",
  () => api<{ data: MetricsResult }>(`/admin/metrics?${query.value}`),
  { server: false, watch: [query] },
)
const m = computed(() => data.value?.data)

// Inline bar chart geometry — no charting dependency.
const chart = computed(() => {
  const series = m.value?.timeseries ?? []
  const max = Math.max(1, ...series.map((p) => p.grossTtc))
  return series.map((p) => ({ ...p, pct: Math.round((p.grossTtc / max) * 100) }))
})
const chartTotal = computed(() => chart.value.reduce((s, p) => s + p.grossTtc, 0))
</script>

<template>
  <div>
    <header class="head">
      <div>
        <p class="eyebrow">Pilotage</p>
        <h1>Métriques</h1>
      </div>
      <div class="presets">
        <button
          v-for="p in PRESETS"
          :key="p.key"
          class="preset"
          :class="{ 'preset--on': preset === p.key }"
          @click="preset = p.key"
        >
          {{ p.label }}
        </button>
      </div>
    </header>

    <p v-if="pending" class="state">Chargement…</p>
    <p v-else-if="error || !m" class="state state--error">Impossible de charger les métriques.</p>

    <template v-else>
      <section class="kpis">
        <div class="kpi kpi--accent">
          <span class="kpi__value">{{ formatEuros(m.revenue.netTtc) }}</span>
          <span class="kpi__label">Chiffre d'affaires net</span>
          <span class="kpi__hint">{{ formatEuros(m.revenue.grossTtc) }} brut · −{{ formatEuros(m.revenue.refundedTtc) }} remboursé</span>
        </div>
        <div class="kpi">
          <span class="kpi__value">{{ formatEuros(m.commission.amount) }}</span>
          <span class="kpi__label">Commission ({{ m.commission.ratePct }}%)</span>
          <span class="kpi__hint">part partenaire sur le CA net</span>
        </div>
        <div class="kpi">
          <span class="kpi__value">{{ m.funnel.conversionPct }}%</span>
          <span class="kpi__label">Conversion</span>
          <span class="kpi__hint">{{ m.funnel.paidOrders }} payées / {{ m.funnel.totalOrders }} commandes</span>
        </div>
        <div class="kpi">
          <span class="kpi__value">{{ m.legalSla.withinSlaPct }}%</span>
          <span class="kpi__label">SLA légal (48h)</span>
          <span class="kpi__hint">
            {{ m.legalSla.withinSla }}/{{ m.legalSla.reviewed }} dans les délais ·
            {{ m.legalSla.pendingOverdue }} en retard
          </span>
        </div>
      </section>

      <section class="panel">
        <div class="panel__head">
          <h2 class="panel__title">Chiffre d'affaires par jour</h2>
          <span class="panel__total">{{ formatEuros(chartTotal) }} encaissés (brut)</span>
        </div>
        <p v-if="chart.length === 0" class="state">Aucune vente sur la période.</p>
        <div v-else class="chart" role="img" aria-label="Chiffre d'affaires quotidien">
          <div v-for="p in chart" :key="p.date" class="bar" :title="`${p.date} — ${formatEuros(p.grossTtc)}`">
            <span class="bar__fill" :style="{ height: `${p.pct}%` }" />
            <span class="bar__day">{{ p.date.slice(8, 10) }}</span>
          </div>
        </div>
      </section>

      <section class="panel">
        <h2 class="panel__title">Entonnoir des commandes</h2>
        <dl class="funnel">
          <div><dt>Total</dt><dd>{{ m.funnel.totalOrders }}</dd></div>
          <div><dt>Payées</dt><dd class="ok">{{ m.funnel.paidOrders }}</dd></div>
          <div><dt>En attente</dt><dd class="warn">{{ m.funnel.pendingOrders }}</dd></div>
          <div><dt>Remboursées</dt><dd>{{ m.funnel.refundedOrders }}</dd></div>
          <div><dt>Échouées / annulées</dt><dd class="bad">{{ m.funnel.failedOrders }}</dd></div>
          <div v-if="m.legalSla.avgReviewHours !== null">
            <dt>Délai moyen de revue doc</dt><dd>{{ m.legalSla.avgReviewHours }} h</dd>
          </div>
        </dl>
      </section>
    </template>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.8rem;
}
.head h1 {
  font-size: clamp(1.9rem, 5vw, 2.6rem);
  margin-top: 0.3rem;
}
.presets {
  display: flex;
  gap: 0.4rem;
}
.preset {
  background: transparent;
  border: 1px solid var(--ink-line);
  color: var(--paper-dim);
  padding: 0.45rem 0.9rem;
  border-radius: 999px;
  font-size: 0.8rem;
  cursor: pointer;
  transition:
    color 0.2s,
    border-color 0.2s;
}
.preset--on {
  color: var(--brass);
  border-color: var(--brass);
}
.kpis {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  margin-bottom: 1.6rem;
}
.kpi {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 1.3rem 1.3rem;
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-left-width: 3px;
  border-radius: var(--radius);
}
.kpi--accent {
  border-left-color: var(--brass);
}
.kpi__value {
  font-family: var(--font-display);
  font-size: 2rem;
  font-weight: 700;
  line-height: 1.05;
}
.kpi__label {
  font-size: 0.9rem;
  font-weight: 600;
  margin-top: 0.3rem;
}
.kpi__hint {
  font-size: 0.74rem;
  color: var(--paper-faint);
}
.panel {
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  padding: 1.3rem 1.4rem;
  margin-bottom: 1.4rem;
}
.panel__head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.2rem;
}
.panel__title {
  font-size: 1.05rem;
}
.panel__total {
  font-size: 0.85rem;
  color: var(--paper-dim);
}
.chart {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 180px;
  overflow-x: auto;
  padding-top: 0.5rem;
}
.bar {
  flex: 1 0 14px;
  min-width: 10px;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  gap: 0.3rem;
}
.bar__fill {
  width: 100%;
  min-height: 2px;
  background: linear-gradient(var(--brass), var(--brass-deep));
  border-radius: 2px 2px 0 0;
  transition: height 0.4s var(--ease);
}
.bar__day {
  font-size: 0.62rem;
  color: var(--paper-faint);
}
.funnel {
  display: grid;
  gap: 0.6rem 1.5rem;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  margin: 0;
}
.funnel div {
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid var(--ink-line);
  padding-bottom: 0.5rem;
}
.funnel dt {
  color: var(--paper-dim);
  font-size: 0.9rem;
}
.funnel dd {
  margin: 0;
  font-weight: 600;
}
.funnel .ok {
  color: var(--brass);
}
.funnel .warn {
  color: #e0b15f;
}
.funnel .bad {
  color: var(--danger);
}
.state {
  color: var(--paper-dim);
  padding: 1.5rem 0;
}
.state--error {
  color: var(--danger);
}
</style>
