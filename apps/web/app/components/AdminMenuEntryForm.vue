<script setup lang="ts">
// Story 12.15b — one menu entry: its label and address, its kind, and the saved
// filter that decides which products it shows. Each entry carries its whole
// filter: a new sub-entry starts from its parent's, to narrow it.
import { LEGAL_CATEGORIES, MENU_DESCRIPTION_MAX, MENU_INTRO_MAX, slugify } from "@armurier/shared"
import type { AdminMenuEntry } from "~/types/menu"
import type { ProductCategoryRef, ProductTag } from "~/types/product"
import { legalCategoryLabel } from "~/utils/product"

type Draft = Omit<AdminMenuEntry, "id" | "position">

const props = defineProps<{
  /** The entry edited, or null for a new one. */
  entryId: string | null
  initial: Draft
  categories: ProductCategoryRef[]
  tags: ProductTag[]
  /** Where the entry may sit: the top, or one of these. */
  parents: Array<{ id: string; label: string }>
}>()
const emit = defineEmits<{ saved: []; cancel: [] }>()

const api = useApi()
const form = reactive<Draft>({ ...props.initial, tagSlugs: [...props.initial.tagSlugs] })
const slugTouched = ref(props.entryId !== null)
const saving = ref(false)
const error = ref<string | null>(null)

const KIND_LABELS = {
  filter: "Filtre sur le catalogue",
  group: "Titre de rubrique (sans page)",
  link: "Lien vers une page",
}

const subcategories = computed(
  () => props.categories.find((category) => category.slug === form.categorySlug)?.subcategories ?? [],
)

watch(
  () => form.label,
  (label) => {
    if (!slugTouched.value) form.slug = slugify(label, 100)
  },
)
watch(
  () => form.categorySlug,
  () => {
    if (!subcategories.value.some((sub) => sub.slug === form.subcategorySlug)) form.subcategorySlug = null
  },
)

function toggleTag(slug: string) {
  form.tagSlugs = form.tagSlugs.includes(slug)
    ? form.tagSlugs.filter((candidate) => candidate !== slug)
    : [...form.tagSlugs, slug]
}

/** Only a filter keeps criteria, only a link an address: the API refuses any other mix. */
function payload() {
  const isFilter = form.kind === "filter"
  return {
    parentId: form.parentId,
    label: form.label,
    slug: form.slug,
    kind: form.kind,
    linkUrl: form.kind === "link" ? form.linkUrl : null,
    categorySlug: isFilter ? form.categorySlug : null,
    subcategorySlug: isFilter ? form.subcategorySlug : null,
    legalCategory: isFilter ? form.legalCategory : null,
    tagSlugs: isFilter ? form.tagSlugs : [],
    // Only a filter has a page to describe.
    description: isFilter ? form.description : null,
    intro: isFilter ? form.intro : null,
  }
}

function messageFrom(err: unknown): string {
  const body = (err as { data?: { message?: string; issues?: Array<{ path: string; message: string }> } }).data
  if (body?.issues?.length) return body.issues.map((issue) => `${issue.path} : ${issue.message}`).join(" · ")
  return body?.message ?? "L'enregistrement a échoué."
}

async function save() {
  saving.value = true
  error.value = null
  try {
    const url = props.entryId ? `/admin/menu/${props.entryId}` : "/admin/menu"
    await api(url, { method: props.entryId ? "PATCH" : "POST", body: payload() })
    emit("saved")
  } catch (err) {
    error.value = messageFrom(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <form class="entry-form" @submit.prevent="save">
    <h2 class="entry-form__title">{{ entryId ? `Modifier « ${initial.label} »` : "Nouvelle entrée" }}</h2>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <label class="field">
      <span class="field__label">Libellé *</span>
      <input v-model="form.label" name="label" class="ctl" required maxlength="100" >
    </label>
    <label class="field">
      <span class="field__label">Adresse (slug) *</span>
      <input v-model="form.slug" name="slug" class="ctl" required maxlength="100" @input="slugTouched = true" >
      <span class="field__help">Un segment de l'URL de l'entrée. Le changer modifie l'adresse des pages déjà indexées.</span>
    </label>
    <label class="field">
      <span class="field__label">Place</span>
      <select v-model="form.parentId" name="parentId" class="ctl">
        <option :value="null">— onglet principal —</option>
        <option v-for="parent in parents" :key="parent.id" :value="parent.id">{{ parent.label }}</option>
      </select>
    </label>
    <label class="field">
      <span class="field__label">Type</span>
      <select v-model="form.kind" name="kind" class="ctl">
        <option v-for="(label, kind) in KIND_LABELS" :key="kind" :value="kind">{{ label }}</option>
      </select>
    </label>

    <label v-if="form.kind === 'link'" class="field">
      <span class="field__label">Page *</span>
      <input v-model="form.linkUrl" name="linkUrl" class="ctl" required placeholder="/collection" >
      <span class="field__help">Une page du site, son adresse commençant par « / ».</span>
    </label>

    <template v-if="form.kind === 'filter'">
      <label class="field">
        <span class="field__label">Catégorie</span>
        <select v-model="form.categorySlug" name="categorySlug" class="ctl">
          <option :value="null">— toutes —</option>
          <option v-for="category in categories" :key="category.slug" :value="category.slug">{{ category.name }}</option>
        </select>
      </label>
      <label v-if="subcategories.length" class="field">
        <span class="field__label">Sous-catégorie</span>
        <select v-model="form.subcategorySlug" name="subcategorySlug" class="ctl">
          <option :value="null">— toutes —</option>
          <option v-for="sub in subcategories" :key="sub.slug" :value="sub.slug">{{ sub.name }}</option>
        </select>
      </label>
      <label class="field">
        <span class="field__label">Catégorie légale</span>
        <select v-model="form.legalCategory" name="legalCategory" class="ctl">
          <option :value="null">— toutes —</option>
          <option v-for="code in LEGAL_CATEGORIES" :key="code" :value="code">{{ legalCategoryLabel(code) }}</option>
        </select>
      </label>
      <div class="field">
        <span class="field__label">Tags</span>
        <div class="tags">
          <button
            v-for="tag in tags"
            :key="tag.slug"
            type="button"
            class="tag"
            :class="{ 'tag--on': form.tagSlugs.includes(tag.slug) }"
            :data-tag="tag.slug"
            :aria-pressed="form.tagSlugs.includes(tag.slug)"
            @click="toggleTag(tag.slug)"
          >
            {{ tag.name }}
          </button>
        </div>
        <span class="field__help">Plusieurs tags d'une même facette : l'un ou l'autre. De facettes différentes : tous.</span>
      </div>

      <label class="field">
        <span class="field__label">Description pour les moteurs de recherche</span>
        <input v-model="form.description" name="description" class="ctl" :maxlength="MENU_DESCRIPTION_MAX" >
        <span class="field__help">
          {{ form.description?.length ?? 0 }} / {{ MENU_DESCRIPTION_MAX }} caractères. Vide : une description est
          composée à partir du chemin de l'entrée.
        </span>
      </label>
      <label class="field">
        <span class="field__label">Introduction de la page</span>
        <textarea v-model="form.intro" name="intro" class="ctl" rows="5" :maxlength="MENU_INTRO_MAX" />
        <span class="field__help">Au-dessus des produits. Une ligne vide sépare deux paragraphes.</span>
      </label>
    </template>

    <div class="actions">
      <button class="btn btn-primary" type="submit" :disabled="saving">
        {{ saving ? "Enregistrement…" : "Enregistrer" }}
      </button>
      <button class="btn btn-ghost" type="button" @click="emit('cancel')">Annuler</button>
    </div>
  </form>
</template>

<style scoped>
.entry-form {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}
.entry-form__title {
  margin: 0 2rem 0 0;
  font-size: var(--fs-md);
  letter-spacing: var(--ls-display);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
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
}
.ctl:focus {
  outline: none;
  border-color: var(--brass);
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.tag {
  padding: 0.3rem 0.7rem;
  background: transparent;
  border: 1px solid var(--ink-line);
  border-radius: 999px;
  color: var(--paper-dim);
  font: inherit;
  font-size: var(--fs-sm);
  cursor: pointer;
}
.tag--on {
  border-color: var(--brass);
  color: var(--brass);
  background: rgba(200, 163, 91, 0.1);
}
.alert {
  background: rgba(217, 138, 106, 0.12);
  border: 1px solid rgba(217, 138, 106, 0.35);
  color: var(--danger);
  padding: 0.7rem 1rem;
  border-radius: var(--radius);
  margin: 0;
  font-size: var(--fs-sm);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.8rem;
  margin-top: 0.6rem;
}
</style>
