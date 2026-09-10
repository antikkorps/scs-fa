<script setup lang="ts">
import { ANCIENT_WEAPON_CONDITIONS, LEGAL_CATEGORIES } from "@armurier/shared"
import type { AdminAncientWeaponDetail } from "~/types/admin-catalogue"

definePageMeta({ layout: "admin", middleware: "admin" })

const route = useRoute()
const api = useApi()
const isNew = computed(() => route.params.id === "nouvelle")
const id = computed(() => route.params.id as string)

useHead({ title: () => `${isNew.value ? "Nouvelle pièce" : "Modifier une pièce"} — Administration SCS` })

const CONDITION_LABELS: Record<string, string> = {
  excellent: "Excellent",
  bon: "Bon",
  moyen: "Moyen",
  restaure: "Restauré",
}

const form = reactive({
  sku: "",
  slug: "",
  name: "",
  description: "",
  longDescription: "",
  categorySlug: "",
  legalCategory: "none" as (typeof LEGAL_CATEGORIES)[number],
  priceHt: 0,
  featuredImageUrl: "",
  published: false,
  tagSlugs: [] as string[],
  period: "",
  periodStartYear: null as number | null,
  periodEndYear: null as number | null,
  provenance: "",
  makerName: "",
  makerLocation: "",
  condition: "bon" as string,
  conditionDescription: "",
  restorationInfo: "",
  isAuthentic: false,
  expertName: "",
  expertDate: "",
})

// Re-bound locally: the import is also used in a `typeof` position, and Vue
// then drops it from the template scope.
const legalCategoryOptions = LEGAL_CATEGORIES
const loadError = ref(false)
const saveError = ref<string | null>(null)
const saving = ref(false)

const { data: categoriesData } = await useAsyncData("aw-categories", () =>
  api<{ data: Array<{ slug: string; name: string }> }>("/product-categories"),
)
const { data: tagsData } = await useAsyncData("aw-tags", () =>
  api<{ data: Array<{ slug: string; name: string }> }>("/admin/tags"),
)
const categories = computed(() => (categoriesData.value?.data ?? []).filter((c) => c.slug !== "gun-art"))
const allTags = computed(() => tagsData.value?.data ?? [])

async function load() {
  if (isNew.value) return
  try {
    const d = (await api<{ data: AdminAncientWeaponDetail }>(`/admin/ancient-weapons/${id.value}`)).data
    Object.assign(form, {
      sku: d.sku,
      slug: d.slug,
      name: d.name,
      description: d.description ?? "",
      longDescription: d.longDescription ?? "",
      categorySlug: d.categorySlug,
      legalCategory: (d.legalCategory ?? "none") as (typeof LEGAL_CATEGORIES)[number],
      priceHt: d.priceHt,
      featuredImageUrl: d.featuredImageUrl ?? "",
      published: d.published,
      tagSlugs: d.tags.map((t) => t.slug),
      period: d.period ?? "",
      periodStartYear: d.periodStartYear,
      periodEndYear: d.periodEndYear,
      provenance: d.provenance ?? "",
      makerName: d.makerName ?? "",
      makerLocation: d.makerLocation ?? "",
      condition: d.condition ?? "bon",
      conditionDescription: d.conditionDescription ?? "",
      restorationInfo: d.restorationInfo ?? "",
      isAuthentic: d.isAuthentic ?? false,
      expertName: d.expertName ?? "",
      expertDate: d.expertDate ?? "",
    })
  } catch {
    loadError.value = true
  }
}
await load()

function toggleTag(slug: string) {
  const i = form.tagSlugs.indexOf(slug)
  if (i === -1) form.tagSlugs.push(slug)
  else form.tagSlugs.splice(i, 1)
}

function payload() {
  const body: Record<string, unknown> = {
    name: form.name,
    legalCategory: form.legalCategory,
    priceHt: Number(form.priceHt),
    published: form.published,
    tagSlugs: form.tagSlugs,
    condition: form.condition,
    isAuthentic: form.isAuthentic,
  }
  for (const key of [
    "description",
    "longDescription",
    "featuredImageUrl",
    "period",
    "provenance",
    "makerName",
    "makerLocation",
    "conditionDescription",
    "restorationInfo",
    "expertName",
    "expertDate",
  ] as const) {
    if (form[key].trim()) body[key] = form[key]
  }
  if (form.periodStartYear) body.periodStartYear = Number(form.periodStartYear)
  if (form.periodEndYear) body.periodEndYear = Number(form.periodEndYear)
  if (isNew.value) {
    body.sku = form.sku
    body.slug = form.slug
    body.categorySlug = form.categorySlug
  }
  return body
}

function messageFrom(err: unknown): string {
  const body = (err as { data?: { message?: string; issues?: Array<{ path: string; message: string }> } }).data
  if (body?.issues?.length) return body.issues.map((i) => `${i.path} : ${i.message}`).join(" · ")
  return body?.message ?? "L'enregistrement a échoué."
}

async function save() {
  saving.value = true
  saveError.value = null
  try {
    if (isNew.value) {
      const res = await api<{ data: AdminAncientWeaponDetail }>("/admin/ancient-weapons", {
        method: "POST",
        body: payload(),
      })
      await navigateTo(`/admin/armes-anciennes/${res.data.id}`)
    } else {
      await api(`/admin/ancient-weapons/${id.value}`, { method: "PATCH", body: payload() })
    }
  } catch (err) {
    saveError.value = messageFrom(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <header class="head">
      <div>
        <p class="eyebrow"><NuxtLink to="/admin/armes-anciennes" class="back">Armes de collection</NuxtLink></p>
        <h1>{{ isNew ? "Nouvelle pièce" : form.name || "Pièce" }}</h1>
      </div>
      <button class="btn btn-primary" type="button" :disabled="saving" @click="save">
        {{ saving ? "Enregistrement…" : "Enregistrer" }}
      </button>
    </header>

    <p v-if="loadError" class="alert" role="alert">Impossible de charger cette pièce.</p>
    <p v-if="saveError" class="alert" role="alert">{{ saveError }}</p>

    <section class="panel">
      <h2 class="panel__title">Identité</h2>
      <div class="fields">
        <label class="field">
          <span class="field__label">SKU *</span>
          <input v-model="form.sku" class="ctl" :disabled="!isNew" >
        </label>
        <label class="field">
          <span class="field__label">Slug (URL) *</span>
          <input v-model="form.slug" class="ctl" :disabled="!isNew" >
        </label>
        <label class="field field--wide">
          <span class="field__label">Nom *</span>
          <input v-model="form.name" class="ctl" >
        </label>
        <label class="field">
          <span class="field__label">Catégorie *</span>
          <select v-model="form.categorySlug" class="ctl" :disabled="!isNew">
            <option value="">— choisir —</option>
            <option v-for="c in categories" :key="c.slug" :value="c.slug">{{ c.name }}</option>
          </select>
        </label>
        <label class="field">
          <span class="field__label">Catégorie légale *</span>
          <select v-model="form.legalCategory" class="ctl">
            <option v-for="c in legalCategoryOptions" :key="c" :value="c">{{ c === "none" ? "Aucune (libre)" : c }}</option>
          </select>
        </label>
        <label class="field">
          <span class="field__label">Prix HT (€) *</span>
          <input v-model.number="form.priceHt" type="number" min="0" step="0.01" class="ctl" >
        </label>
        <label class="field field--wide">
          <span class="field__label">Description courte</span>
          <textarea v-model="form.description" class="ctl ctl--area" rows="2" />
        </label>
        <label class="field field--wide">
          <span class="field__label">Récit de la pièce</span>
          <textarea v-model="form.longDescription" class="ctl ctl--area" rows="8" />
          <span class="field__help">C'est ce texte qui porte la valeur de la pièce — le client en attend une trentaine de lignes.</span>
        </label>
      </div>
    </section>

    <section class="panel">
      <h2 class="panel__title">Histoire & provenance</h2>
      <div class="fields">
        <label class="field">
          <span class="field__label">Époque</span>
          <input v-model="form.period" class="ctl" >
        </label>
        <label class="field">
          <span class="field__label">Fabricant</span>
          <input v-model="form.makerName" class="ctl" >
        </label>
        <label class="field">
          <span class="field__label">Année de début</span>
          <input v-model.number="form.periodStartYear" type="number" class="ctl" >
        </label>
        <label class="field">
          <span class="field__label">Année de fin</span>
          <input v-model.number="form.periodEndYear" type="number" class="ctl" >
        </label>
        <label class="field">
          <span class="field__label">Lieu de fabrication</span>
          <input v-model="form.makerLocation" class="ctl" >
        </label>
        <label class="field field--wide">
          <span class="field__label">Provenance</span>
          <textarea v-model="form.provenance" class="ctl ctl--area" rows="2" />
        </label>
      </div>
    </section>

    <section class="panel">
      <h2 class="panel__title">État & authenticité</h2>
      <div class="fields">
        <label class="field">
          <span class="field__label">État *</span>
          <select v-model="form.condition" class="ctl">
            <option v-for="c in ANCIENT_WEAPON_CONDITIONS" :key="c" :value="c">{{ CONDITION_LABELS[c] ?? c }}</option>
          </select>
        </label>
        <label class="field field--check">
          <input v-model="form.isAuthentic" type="checkbox" class="check" >
          <span>Authenticité vérifiée</span>
        </label>
        <label class="field">
          <span class="field__label">Expert</span>
          <input v-model="form.expertName" class="ctl" >
        </label>
        <label class="field">
          <span class="field__label">Date d'expertise</span>
          <input v-model="form.expertDate" type="date" class="ctl" >
        </label>
        <label class="field field--wide">
          <span class="field__label">Description de l'état</span>
          <textarea v-model="form.conditionDescription" class="ctl ctl--area" rows="3" />
        </label>
        <label class="field field--wide">
          <span class="field__label">Restaurations</span>
          <textarea v-model="form.restorationInfo" class="ctl ctl--area" rows="3" />
        </label>
      </div>
    </section>

    <section class="panel">
      <h2 class="panel__title">Tags & publication</h2>
      <div v-if="allTags.length > 0" class="tags">
        <button
          v-for="t in allTags"
          :key="t.slug"
          type="button"
          class="tag"
          :class="{ 'tag--on': form.tagSlugs.includes(t.slug) }"
          :aria-pressed="form.tagSlugs.includes(t.slug)"
          @click="toggleTag(t.slug)"
        >
          {{ t.name }}
        </button>
      </div>
      <div class="fields fields--spaced">
        <label class="field field--wide">
          <span class="field__label">Visuel principal (URL)</span>
          <input v-model="form.featuredImageUrl" class="ctl" >
        </label>
        <label class="field field--check">
          <input v-model="form.published" type="checkbox" class="check" >
          <span>Publiée sur le site</span>
        </label>
      </div>
    </section>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.4rem;
}
.eyebrow {
  margin: 0;
  font-size: 0.72rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--paper-faint);
}
.back {
  color: var(--paper-faint);
  text-decoration: none;
}
.back:hover {
  color: var(--brass);
}
h1 {
  margin: 0.3rem 0 0;
  font-size: clamp(1.8rem, 5vw, 2.4rem);
}
.panel {
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  padding: 1.3rem 1.4rem;
  margin-bottom: 1.4rem;
}
.panel__title {
  margin: 0 0 1.1rem;
  font-size: 0.72rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--paper-faint);
}
.fields {
  display: grid;
  gap: 1.1rem;
  grid-template-columns: 1fr;
}
.fields--spaced {
  margin-top: 1.4rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.field--check {
  flex-direction: row;
  align-items: center;
  gap: 0.6rem;
  color: var(--paper-dim);
  font-size: 0.9rem;
}
.field__label {
  font-size: 0.72rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--paper-faint);
  font-weight: 600;
}
.field__help {
  font-size: 0.76rem;
  color: var(--paper-faint);
  line-height: 1.5;
}
.ctl {
  padding: 0.6rem 0.8rem;
  background: var(--ink);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper);
  font-family: inherit;
  font-size: 0.92rem;
  width: 100%;
}
.ctl:focus {
  outline: none;
  border-color: var(--brass);
}
.ctl:disabled {
  opacity: 0.55;
}
.ctl--area {
  line-height: 1.6;
  resize: vertical;
}
.check {
  width: 1.1rem;
  height: 1.1rem;
  accent-color: var(--brass);
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.tag {
  padding: 0.4rem 0.85rem;
  background: transparent;
  border: 1px solid var(--ink-line);
  border-radius: 999px;
  color: var(--paper-dim);
  font: inherit;
  font-size: 0.82rem;
  cursor: pointer;
}
.tag--on {
  border-color: var(--brass);
  color: var(--brass);
}
.alert {
  background: rgba(217, 138, 106, 0.12);
  border: 1px solid rgba(217, 138, 106, 0.35);
  color: var(--danger);
  padding: 0.7rem 1rem;
  border-radius: var(--radius);
  margin: 0 0 1.2rem;
  font-size: 0.88rem;
}

@media (min-width: 720px) {
  .fields {
    grid-template-columns: 1fr 1fr;
  }
  .field--wide {
    grid-column: 1 / -1;
  }
}
</style>
