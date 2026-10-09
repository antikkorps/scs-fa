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
 * be deleted.
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
}>()

const emit = defineEmits<(e: "changed") => void>()

const api = useApi()
const removeError = ref<string | null>(null)

function cell(row: CatalogueRow, key: string): unknown {
  return (row as unknown as Record<string, unknown>)[key]
}

const isArchived = (row: CatalogueRow) => Boolean(cell(row, "archivedAt"))

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
    <p v-if="rows.length === 0" class="state">Aucun {{ noun }} pour l'instant.</p>

    <section v-else class="panel">
      <div class="tablewrap">
        <table class="grid">
          <thead>
            <tr>
              <th v-for="c in columns" :key="c.key" scope="col">{{ c.label }}</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id" :class="{ 'row--archived': archivable && isArchived(row) }">
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
                  <NuxtLink :to="`${editBase}/${row.id}`" class="link">Modifier</NuxtLink>
                  <button v-if="archivable" class="link" type="button" @click="toggleArchive(row)">
                    {{ isArchived(row) ? "Réactiver" : "Archiver" }}
                  </button>
                  <button class="link link--danger" type="button" @click="remove(row)">Supprimer</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
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
.tablewrap {
  overflow-x: auto;
  /* Anchors the visually-hidden header: positioned against the page, it widened it on mobile. */
  position: relative;
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
/* Stacked, so a third action does not push the table past its frame. */
.actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.2rem;
}
.link {
  background: none;
  border: 0;
  color: var(--paper-dim);
  font: inherit;
  font-size: var(--fs-sm);
  cursor: pointer;
  padding: 0 0 0 0.8rem;
  text-decoration: none;
}
.link:hover {
  color: var(--brass);
}
.link--danger:hover {
  color: var(--danger);
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
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
</style>
