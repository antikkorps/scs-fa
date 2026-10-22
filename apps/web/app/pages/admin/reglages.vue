<script setup lang="ts">
import { calculateVipDiscount } from "@armurier/shared"
import { formatEuros } from "~/utils/format"

definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Réglages — Administration SCS" })

// Story 12.9e — the shop settings: today, the share of the margin a VIP gets
// back. Each change is journaled server-side; orders already placed keep the
// discount they were sold with.
interface ShopSettings {
  vipMarginSharePct: number
}

const api = useApi()

const { data, pending, error } = await useAsyncData(
  "admin-shop-settings",
  () => api<{ data: ShopSettings }>("/admin/shop-settings"),
  { server: false },
)

const form = reactive({ vipMarginSharePct: 50 })

watch(
  () => data.value?.data,
  (settings) => {
    if (settings) form.vipMarginSharePct = settings.vipMarginSharePct
  },
  { immediate: true },
)

// What the share means on a typical firearm: 1 000 € HT sold at 30 % margin.
const EXAMPLE_PRICE_HT = 1000
const EXAMPLE_MARGIN_PCT = 30
const example = computed(() =>
  calculateVipDiscount(EXAMPLE_PRICE_HT, EXAMPLE_MARGIN_PCT, "arme-longue", Number(form.vipMarginSharePct)),
)

const saving = ref(false)
const saveError = ref<string | null>(null)
const saved = ref(false)

async function save() {
  saving.value = true
  saveError.value = null
  saved.value = false
  try {
    const body: ShopSettings = { vipMarginSharePct: Number(form.vipMarginSharePct) }
    data.value = await api<{ data: ShopSettings }>("/admin/shop-settings", { method: "PUT", body })
    saved.value = true
  } catch (err) {
    const status = (err as { response?: { status?: number } }).response?.status
    saveError.value =
      status === 400
        ? "Part invalide : un pourcentage entre 0 et 100, au centième près."
        : "L'enregistrement a échoué. Réessayez."
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <header class="head">
      <p class="eyebrow">Boutique</p>
      <h1>Réglages</h1>
      <p class="intro">
        Une modification vaut pour les paniers à venir : les commandes déjà passées gardent la remise avec laquelle
        elles ont été vendues. Chaque changement est tracé.
      </p>
    </header>

    <p v-if="pending" class="state">Chargement…</p>
    <p v-else-if="error" class="state">Impossible de charger les réglages.</p>

    <form v-else class="grid" @submit.prevent="save">
      <label class="field">
        <span class="field__label">Remise VIP — part de la marge rendue (%)</span>
        <input v-model.number="form.vipMarginSharePct" type="number" min="0" max="100" step="0.01" class="ctl" required >
        <span class="field__help">
          Le client VIP récupère cette part de la marge de chaque article, hors munitions et hors frais de port. Il
          devient VIP à sa première arme neuve payée et dont les documents sont validés, et le reste tant qu'il ne la
          retourne pas.
        </span>
      </label>

      <p class="example">
        Exemple : une arme à {{ formatEuros(EXAMPLE_PRICE_HT) }} HT avec {{ EXAMPLE_MARGIN_PCT }} % de marge →
        remise de <strong>{{ formatEuros(example.discountAmount) }}</strong> HT ({{ example.discountPct }} %).
      </p>

      <div class="actions">
        <button class="btn btn-primary" type="submit" :disabled="saving">
          {{ saving ? "Enregistrement…" : "Enregistrer" }}
        </button>
        <span v-if="saved" class="ok" role="status">Réglages enregistrés.</span>
        <span v-if="saveError" class="err" role="alert">{{ saveError }}</span>
      </div>
    </form>
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
.grid {
  display: grid;
  gap: 1.4rem;
  max-width: 34rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.field--check {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  color: var(--paper-dim);
  cursor: pointer;
}
.field__label {
  font-size: var(--fs-xs);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--paper-faint);
  font-weight: var(--fw-semibold);
}
.field__help {
  font-size: var(--fs-sm);
  color: var(--paper-faint);
  line-height: var(--lh-normal);
}
.ctl {
  padding: 0.6rem 0.8rem;
  background: var(--ink);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper);
  font-family: inherit;
  font-size: var(--fs-base);
  width: 100%;
  max-width: 12rem;
}
.ctl:focus {
  outline: none;
  border-color: var(--brass);
}
.check {
  width: 1.1rem;
  height: 1.1rem;
  accent-color: var(--brass);
}
.example {
  margin: 0;
  padding: 0.9rem 1rem;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper-dim);
  font-size: var(--fs-sm);
}
.actions {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}
.ok {
  color: var(--brass);
  font-size: var(--fs-sm);
}
.err {
  color: var(--danger);
  font-size: var(--fs-sm);
}
</style>
