<script setup lang="ts">
/**
 * The list half of a catalogue screen: rows, an edit link, a delete button and
 * the server's refusal message when a deletion is blocked.
 *
 * Products and collection weapons both need exactly this, and the deletion
 * refusal ("this appears on an order — unpublish it instead") is the part worth
 * writing once: it is the message that keeps a purchase trail from being erased.
 *
 * With `archivable` (products, story 12.4) each row also gets "Archiver" /
 * "Réactiver": the way out for a product that is on an order and can no longer
 * be deleted. With `selectable` (story 12.16b) rows on sale can be ticked and
 * archived in one go.
 */
export interface CatalogueColumn {
  key: string
  label: string
  numeric?: boolean
  boolean?: boolean
}

/**
 * A row only has to carry an id; the columns say which of its keys to render.
 * Typed this loosely on purpose — an interface has no index signature, so
 * demanding `Record<string, unknown>` here would reject every caller's type.
 */
export interface CatalogueRow {
  id: string
}

const props = defineProps<{
  rows: readonly CatalogueRow[]
  columns: CatalogueColumn[]
  /** Where an edit link points: `${editBase}/${id}`. */
  editBase: string
  endpoint: string
  labelKey: string
  noun: string
  /** Rows carry `archivedAt`; offer archive / restore next to delete. */
  archivable?: boolean
  /** Rows on sale get a box; the ticked ones are archived in one call. */
  selectable?: boolean
  /** Said when there is no row, e.g. under a filter; defaults to "nothing yet". */
  emptyMessage?: string
}>()

const emit = defineEmits<(e: "changed") => void>()

const api = useApi()
const removeError = ref<string | null>(null)

function cell(row: CatalogueRow, key: string): unknown {
  return (row as unknown as Record<string, unknown>)[key]
}

const isArchived = (row: CatalogueRow) => Boolean(cell(row, "archivedAt"))

const bulk = useBulkArchive({
  rows: computed(() => props.rows.map((row) => ({ id: row.id, archivedAt: cell(row, "archivedAt") }))),
  endpoint: toRef(props, "endpoint"),
  noun: toRef(props, "noun"),
  onArchived: () => emit("changed"),
})
const { selected, selectableIds, allSelected, someSelected, busy, message: bulkMessage, error: bulkError } = bulk

async function toggleArchive(row: CatalogueRow) {
  const label = String(cell(row, props.labelKey) ?? row.id)
  const archive = !isArchived(row)
  if (archive && !confirm(`Archiver « ${label} » ? Il sera retiré de la vente, sans être effacé.`)) return
  removeError.value = null
  try {
    await api(`${props.endpoint}/${row.id}/${archive ? "archive" : "restore"}`, { method: "POST" })
    emit("changed")
  } catch (err) {
    const body = (err as { data?: { message?: string } }).data
    removeError.value = body?.message ?? "L'opération a échoué."
  }
}

async function remove(row: CatalogueRow) {
  const label = String(cell(row, props.labelKey) ?? row.id)
  if (!confirm(`Supprimer « ${label} » ? Cette action est définitive.`)) return
  removeError.value = null
  try {
    await api(`${props.endpoint}/${row.id}`, { method: "DELETE" })
    emit("changed")
  } catch (err) {
    const { data: body, statusCode } = err as { data?: { message?: string }; statusCode?: number }
    removeError.value =
      props.archivable && statusCode === 409
        ? `« ${label} » figure sur une commande : archivez-le plutôt que de le supprimer.`
        : (body?.message ?? "La suppression a échoué.")
  }
}
</script>

<template>
  <div>
    <p v-if="removeError" class="alert" role="alert">{{ removeError }}</p>
    <p v-if="bulkError" class="alert" role="alert">{{ bulkError }}</p>
    <!-- Always rendered: a live region inserted along with its text is often not read out. -->
    <div role="status" aria-live="polite">
      <p v-if="bulkMessage" class="notice">{{ bulkMessage }}</p>
    </div>
    <div v-if="selectable && selected.size" class="bulk">
      <button type="button" class="bulk__archive" :disabled="busy" @click="bulk.archiveSelected()">
        Archiver la sélection ({{ selected.size }})
      </button>
    </div>
    <p v-if="rows.length === 0" class="state">{{ emptyMessage ?? `Aucun ${noun} pour l'instant.` }}</p>

    <section v-else class="panel">
      <AdminDualScroll>
        <table class="grid">
          <thead>
            <tr>
              <th v-if="selectable" scope="col" class="cell--pick">
                <input
                  v-if="selectableIds.length"
                  type="checkbox"
                  :checked="allSelected"
                  :indeterminate="someSelected"
                  aria-label="Tout sélectionner"
                  @change="bulk.toggleAll(($event.target as HTMLInputElement).checked)"
                />
              </th>
              <th v-for="c in columns" :key="c.key" scope="col">{{ c.label }}</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id" :class="{ 'row--archived': archivable && isArchived(row) }">
              <td v-if="selectable" class="cell--pick">
                <input
                  v-if="!isArchived(row)"
                  type="checkbox"
                  :checked="selected.has(row.id)"
                  :aria-label="`Sélectionner ${cell(row, labelKey)}`"
                  @change="bulk.toggle(row.id, ($event.target as HTMLInputElement).checked)"
                />
              </td>
              <td v-for="(c, i) in columns" :key="c.key" :class="{ 'cell--num': c.numeric }">
                <template v-if="i === 0">
                  <NuxtLink :to="`${editBase}/${row.id}`" class="title">{{ cell(row, c.key) }}</NuxtLink>
                  <span v-if="archivable && isArchived(row)" class="badge">Archivé</span>
                </template>
                <template v-else-if="c.boolean">{{ cell(row, c.key) ? "Oui" : "Non" }}</template>
                <template v-else>{{ cell(row, c.key) ?? "—" }}</template>
              </td>
              <td class="cell--actions">
                <div class="actions">
                  <AdminRowAction icon="edit" label="Modifier" :to="`${editBase}/${row.id}`" />
                  <AdminRowAction
                    v-if="archivable"
                    :icon="isArchived(row) ? 'restore' : 'archive'"
                    :label="isArchived(row) ? 'Réactiver' : 'Archiver'"
                    @click="toggleArchive(row)"
                  />
                  <AdminRowAction icon="delete" label="Supprimer" danger @click="remove(row)" />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </AdminDualScroll>
    </section>
  </div>
</template>

<style scoped>
.panel {
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  padding: 1.3rem 1.4rem;
}
.grid {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
}
.grid th,
.grid td {
  padding: 0.55rem 0.7rem;
  border-bottom: 1px solid var(--ink-line);
  text-align: left;
}
.grid thead th {
  color: var(--paper-faint);
  font-size: var(--fs-xs);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  white-space: nowrap;
}
.row--archived td {
  color: var(--paper-faint);
}
.badge {
  margin-left: 0.5rem;
  padding: 0.05rem 0.4rem;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  font-size: var(--fs-xs);
  color: var(--paper-faint);
}
.title {
  color: var(--paper);
  text-decoration: none;
}
.title:hover {
  color: var(--brass);
}
.cell--num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--paper-dim);
}
.cell--actions {
  white-space: nowrap;
}
/* Icons side by side: three actions fit where one word used to. */
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.15rem;
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
.notice {
  border: 1px solid var(--ink-line);
  color: var(--paper-dim);
  padding: 0.7rem 1rem;
  border-radius: var(--radius);
  margin: 0 0 1.2rem;
  font-size: var(--fs-sm);
}
.bulk {
  display: flex;
  gap: 0.75rem;
  margin: 0 0 1rem;
}
.bulk__archive {
  padding: 0.5rem 0.9rem;
  border: 1px solid var(--brass);
  border-radius: var(--radius);
  background: none;
  color: var(--brass);
  font-size: var(--fs-sm);
  cursor: pointer;
}
.bulk__archive:disabled {
  opacity: 0.6;
  cursor: wait;
}
.cell--pick {
  width: 2rem;
}
.state {
  color: var(--paper-dim);
  padding: 1.5rem 0;
}
</style>
