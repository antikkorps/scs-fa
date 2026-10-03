<script setup lang="ts">
import type { ShippingRates } from "@armurier/shared"
import { formatEuros } from "~/utils/format"

definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Frais de port — Administration SCS" })

// Story 12.3 — the shipping rate grid. The four amounts form one tariff and are
// saved together; each change is journaled server-side. Orders already placed
// keep the delivery cost they were sold with.
const api = useApi()

const { data, pending, error } = await useAsyncData(
  "admin-shipping-rates",
  () => api<{ data: ShippingRates }>("/admin/shipping-rates"),
  { server: false },
)

const form = reactive({
  firearmParcelTtc: 0,
  smallParcelTtc: 0,
  freeEnabled: true,
  smallParcelFreeFromTtc: 0,
  printTtc: 0,
})

watch(
  () => data.value?.data,
  (rates) => {
    if (!rates) return
    Object.assign(form, {
      firearmParcelTtc: rates.firearmParcelTtc,
      smallParcelTtc: rates.smallParcelTtc,
      freeEnabled: rates.smallParcelFreeFromTtc !== null,
      smallParcelFreeFromTtc: rates.smallParcelFreeFromTtc ?? 150,
      printTtc: rates.printTtc,
    })
  },
  { immediate: true },
)

const saving = ref(false)
const saveError = ref<string | null>(null)
const saved = ref(false)

async function save() {
  saving.value = true
  saveError.value = null
  saved.value = false
  try {
    const body: ShippingRates = {
      firearmParcelTtc: Number(form.firearmParcelTtc),
      smallParcelTtc: Number(form.smallParcelTtc),
      smallParcelFreeFromTtc: form.freeEnabled ? Number(form.smallParcelFreeFromTtc) : null,
      printTtc: Number(form.printTtc),
    }
    const res = await api<{ data: ShippingRates }>("/admin/shipping-rates", { method: "PUT", body })
    data.value = res
    saved.value = true
  } catch (err) {
    const status = (err as { response?: { status?: number } }).response?.status
    saveError.value =
      status === 400
        ? "Montants invalides : des euros positifs, au centime près."
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
      <h1>Frais de port</h1>
      <p class="intro">
        Montants <strong>TTC</strong>, tels que le client les lit. Livraison en France métropolitaine, Corse comprise ;
        la remise VIP ne s'applique jamais au port. Une modification vaut pour les commandes à venir : celles déjà
        passées gardent leurs frais.
      </p>
    </header>

    <p v-if="pending" class="state">Chargement…</p>
    <p v-else-if="error" class="state">Impossible de charger la grille.</p>

    <form v-else class="grid" @submit.prevent="save">
      <label class="field">
        <span class="field__label">Arme — par colis</span>
        <input v-model.number="form.firearmParcelTtc" type="number" min="0" step="0.01" class="ctl" required >
        <span class="field__help">
          Envoi assuré, remis contre signature. Compté par colis : une arme de catégorie B, livrée en 2 colis, le paie
          deux fois (nombre de colis réglé sur chaque article).
        </span>
      </label>

      <label class="field">
        <span class="field__label">Munitions et accessoires — par commande</span>
        <input v-model.number="form.smallParcelTtc" type="number" min="0" step="0.01" class="ctl" required >
        <span class="field__help">Un seul forfait, quel que soit le nombre d'articles (optiques, munitions, accessoires…).</span>
      </label>

      <div class="field">
        <label class="field--check">
          <input v-model="form.freeEnabled" type="checkbox" class="check" >
          <span>Offrir ce forfait à partir d'un montant</span>
        </label>
        <input
          v-if="form.freeEnabled"
          v-model.number="form.smallParcelFreeFromTtc"
          type="number"
          min="0"
          step="0.01"
          class="ctl"
          aria-label="Seuil de gratuité (TTC)"
          required
        >
        <span class="field__help">
          Montant TTC des munitions et accessoires (remise VIP déduite). Les armes et les tirages ne sont jamais
          offerts.
        </span>
      </div>

      <label class="field">
        <span class="field__label">Tirage Gun Art — par tirage</span>
        <input v-model.number="form.printTtc" type="number" min="0" step="0.01" class="ctl" required >
        <span class="field__help">Emballage dédié, un envoi par tirage.</span>
      </label>

      <p class="example">
        Exemple : une arme de catégorie B, une boîte de munitions et un tirage =
        <strong>{{
          formatEuros(
            2 * Number(form.firearmParcelTtc) + Number(form.smallParcelTtc) + Number(form.printTtc),
          )
        }}</strong>
        de port.
      </p>

      <div class="actions">
        <button class="btn btn-primary" type="submit" :disabled="saving">
          {{ saving ? "Enregistrement…" : "Enregistrer la grille" }}
        </button>
        <span v-if="saved" class="ok" role="status">Grille enregistrée.</span>
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
