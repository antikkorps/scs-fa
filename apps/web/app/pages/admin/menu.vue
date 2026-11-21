<script setup lang="ts">
// Story 12.15b — the shop menu, edited by the shop's staff: its tabs and their
// entries, three levels at most, each entry a saved filter over the catalogue.
// Armes de collection and Gun Art stand apart in the header, outside this tree.
import { MENU_MAX_DEPTH } from "@armurier/shared"
import type { AdminMenuEntry, PlacedMenuEntry } from "~/types/menu"
import type { ProductCategoryRef, ProductTag } from "~/types/product"
import { branchHeight, childrenOf, descendantCount, filterSummary, placeEntries } from "~/utils/menu-tree"

definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Menu de la boutique — Administration SCS" })

type Draft = Omit<AdminMenuEntry, "id" | "position">

const api = useApi()
const entries = ref<AdminMenuEntry[]>([])
const categories = ref<ProductCategoryRef[]>([])
const tags = ref<ProductTag[]>([])
const listError = ref(false)
const actionError = ref<string | null>(null)
const editing = ref<{ entryId: string | null; initial: Draft } | null>(null)

async function load() {
  listError.value = false
  try {
    entries.value = (await api<{ data: AdminMenuEntry[] }>("/admin/menu")).data
  } catch {
    listError.value = true
  }
}

// The option lists only name things: missing, the summaries show slugs.
async function loadReferences() {
  const [categoryList, tagList] = await Promise.allSettled([
    api<{ data: ProductCategoryRef[] }>("/product-categories"),
    api<{ data: ProductTag[] }>("/admin/tags"),
  ])
  if (categoryList.status === "fulfilled") categories.value = categoryList.value.data
  if (tagList.status === "fulfilled") tags.value = tagList.value.data
}

await Promise.all([load(), loadReferences()])

const placed = computed(() => placeEntries(entries.value))
const tagNames = computed(() => new Map(tags.value.map((tag) => [tag.slug, tag.name])))

const canHaveChildren = (row: PlacedMenuEntry) => row.level < MENU_MAX_DEPTH && row.entry.kind !== "link"

function siblingsOf(entry: AdminMenuEntry) {
  return childrenOf(entries.value, entry.parentId)
}

/** Where the edited entry may go: not in its own branch, nor where the branch would pass the last level. */
const parentOptions = computed(() => {
  const editedId = editing.value?.entryId
  const editedPath = placed.value.find((row) => row.entry.id === editedId)?.path
  const height = editedId ? branchHeight(entries.value, editedId) : 1
  return placed.value
    .filter((row) => canHaveChildren(row) && row.level + height <= MENU_MAX_DEPTH)
    .filter((row) => !editedPath || (row.path !== editedPath && !row.path.startsWith(`${editedPath}/`)))
    .map((row) => ({ id: row.entry.id, label: `${"— ".repeat(row.level - 1)}${row.entry.label}` }))
})

const BLANK: Draft = {
  parentId: null,
  slug: "",
  label: "",
  kind: "filter",
  linkUrl: null,
  categorySlug: null,
  subcategorySlug: null,
  legalCategory: null,
  tagSlugs: [],
}

function startCreate(parent: AdminMenuEntry | null) {
  // A sub-entry narrows its parent: it starts from the parent's filter.
  const { categorySlug, subcategorySlug, legalCategory, tagSlugs } = parent?.kind === "filter" ? parent : BLANK
  editing.value = {
    entryId: null,
    initial: { ...BLANK, parentId: parent?.id ?? null, categorySlug, subcategorySlug, legalCategory, tagSlugs },
  }
}

function startEdit(entry: AdminMenuEntry) {
  const { id, position: _position, ...initial } = entry
  editing.value = { entryId: id, initial }
}

async function afterSave() {
  editing.value = null
  await load()
}

async function act(action: () => Promise<unknown>) {
  actionError.value = null
  try {
    await action()
  } catch (err) {
    actionError.value = (err as { data?: { message?: string } }).data?.message ?? "L'opération a échoué. Réessayez."
  }
  await load()
}

function move(entry: AdminMenuEntry, offset: -1 | 1) {
  const ids = siblingsOf(entry).map((sibling) => sibling.id)
  const from = ids.indexOf(entry.id)
  const [moved] = ids.splice(from, 1)
  if (moved) ids.splice(from + offset, 0, moved)
  return act(() => api("/admin/menu/order", { method: "PUT", body: { parentId: entry.parentId, ids } }))
}

function remove(entry: AdminMenuEntry) {
  const count = descendantCount(entries.value, entry.id)
  const branch = count > 0 ? ` et ses ${count} sous-entrées` : ""
  if (!confirm(`Supprimer « ${entry.label} »${branch} du menu ? Aucun produit n'est supprimé.`)) return
  return act(() => api(`/admin/menu/${entry.id}`, { method: "DELETE" }))
}

const isFirst = (entry: AdminMenuEntry) => siblingsOf(entry)[0]?.id === entry.id
const isLast = (entry: AdminMenuEntry) => siblingsOf(entry).at(-1)?.id === entry.id
</script>

<template>
  <div>
    <header class="head">
      <div>
        <p class="eyebrow">Catalogue</p>
        <h1>Menu de la boutique</h1>
      </div>
      <button class="btn-add" type="button" @click="startCreate(null)">+ Nouvel onglet</button>
    </header>
    <p class="intro">
      Les onglets du site et leurs entrées, sur trois niveaux. Chaque entrée est un filtre sur le catalogue : un produit
      bien rangé (catégorie, sous-catégorie, tags) apparaît sous toutes les entrées qui le concernent, sans double
      saisie. Armes de collection et Gun Art restent à part, mis en avant dans l'en-tête.
    </p>

    <p v-if="actionError" class="alert" role="alert">{{ actionError }}</p>
    <p v-if="listError" class="state state--error">Impossible de charger le menu.</p>
    <p v-else-if="placed.length === 0" class="state">Le menu est vide.</p>

    <ul v-else class="tree">
      <li v-for="row in placed" :key="row.entry.id" class="entry" :data-level="row.level">
        <div class="entry__main">
          <span class="entry__label">{{ row.entry.label }}</span>
          <span class="entry__path">{{ row.entry.kind === "link" ? row.entry.linkUrl : row.path }}</span>
          <span class="entry__filter">
            <template v-if="row.entry.kind === 'filter'">{{ filterSummary(row.entry, categories, tagNames) }}</template>
            <template v-else-if="row.entry.kind === 'group'">Titre de rubrique</template>
            <template v-else>Lien</template>
          </span>
        </div>
        <div class="entry__actions">
          <AdminRowAction v-if="!isFirst(row.entry)" icon="up" label="Monter" @click="move(row.entry, -1)" />
          <AdminRowAction v-if="!isLast(row.entry)" icon="down" label="Descendre" @click="move(row.entry, 1)" />
          <AdminRowAction
            v-if="canHaveChildren(row)"
            icon="add"
            label="Ajouter une sous-entrée"
            @click="startCreate(row.entry)"
          />
          <AdminRowAction icon="edit" label="Modifier" @click="startEdit(row.entry)" />
          <AdminRowAction icon="delete" label="Supprimer" danger @click="remove(row.entry)" />
        </div>
      </li>
    </ul>

    <AdminDrawer v-if="editing" label="Entrée du menu" @close="editing = null">
      <AdminMenuEntryForm
        :key="editing.entryId ?? `new-${editing.initial.parentId}`"
        :entry-id="editing.entryId"
        :initial="editing.initial"
        :categories="categories"
        :tags="tags"
        :parents="parentOptions"
        @saved="afterSave"
        @cancel="editing = null"
      />
    </AdminDrawer>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.eyebrow {
  margin: 0;
  font-size: var(--fs-xs);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--paper-faint);
}
h1 {
  margin: 0.3rem 0 0;
  font-size: var(--fs-2xl);
}
.intro {
  max-width: 72ch;
  margin: 0 0 1.5rem;
  color: var(--paper-dim);
  line-height: var(--lh-relaxed);
}
.btn-add {
  padding: 0.55rem 1rem;
  background: transparent;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper-dim);
  font: inherit;
  font-size: var(--fs-sm);
  cursor: pointer;
}
.btn-add:hover {
  border-color: var(--brass);
  color: var(--brass);
}
.tree {
  list-style: none;
  margin: 0;
  padding: 0;
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
}
.entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.6rem 1rem;
  border-bottom: 1px solid var(--ink-line);
}
.entry:last-child {
  border-bottom: none;
}
.entry[data-level="1"] {
  background: rgba(200, 163, 91, 0.05);
}
.entry[data-level="2"] {
  padding-left: 2.2rem;
}
.entry[data-level="3"] {
  padding-left: 3.8rem;
}
.entry__main {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.3rem 0.9rem;
  min-width: 0;
}
.entry__label {
  color: var(--paper);
}
.entry[data-level="1"] .entry__label {
  font-weight: var(--fw-semibold);
}
.entry__path {
  font-family: var(--font-mono, monospace);
  font-size: var(--fs-xs);
  color: var(--paper-faint);
}
.entry__filter {
  font-size: var(--fs-sm);
  color: var(--paper-dim);
}
.entry__actions {
  display: inline-flex;
  gap: 0.15rem;
  flex-shrink: 0;
}
.alert {
  background: rgba(217, 138, 106, 0.12);
  border: 1px solid rgba(217, 138, 106, 0.35);
  color: var(--danger);
  padding: 0.7rem 1rem;
  border-radius: var(--radius);
  margin: 0 0 1.2rem;
  font-size: var(--fs-sm);
}
.state {
  color: var(--paper-dim);
  padding: 1.5rem 0;
}
.state--error {
  color: var(--danger);
}
</style>
