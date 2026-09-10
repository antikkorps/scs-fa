<script setup lang="ts">
/**
 * List + inline form for a small admin entity (story 7.5a).
 *
 * Artists, themes, series and tags are all "a handful of rows with a dozen
 * fields". Giving each its own list page, create page and edit page would be
 * three files of the same code four times over; this component is driven by a
 * field description instead. Artworks and products, whose forms carry variants
 * and price grids, keep their own dedicated pages.
 */
export interface AdminField {
  key: string
  label: string
  type: "text" | "textarea" | "number" | "checkbox" | "select" | "url"
  /** Static choices for a select. */
  options?: Array<{ value: string; label: string }>
  /** Choices fetched from another admin endpoint (id + a label field). */
  optionsEndpoint?: string
  optionsLabel?: string
  required?: boolean
  help?: string
  /** Fields that identify the row and can never be changed after creation. */
  createOnly?: boolean
}

export interface AdminColumn {
  key: string
  label: string
  /** Rendered as a muted count badge. */
  numeric?: boolean
}

const props = defineProps<{
  title: string
  /** Admin API path, e.g. "/admin/gun-art/artists". */
  endpoint: string
  fields: AdminField[]
  columns: AdminColumn[]
  /** Singular noun used in the confirmations, e.g. "artiste". */
  noun: string
  /**
   * French elides and genders, so the labels are given rather than assembled:
   * "Nouveau artiste" and "Aucun série" is what building them by hand produces.
   */
  newLabel: string
  emptyLabel: string
  /** Shown under the title — say what the entity is for. */
  intro?: string
  /**
   * When set, an existing row gets its media gallery under the form. Absent
   * while creating: there is no owner id to attach an image to yet.
   */
  mediaOwnerType?: "product" | "artwork" | "artwork_series" | "artist"
}>()

type Row = Record<string, unknown> & { id: string }

const api = useApi()
const rows = ref<Row[]>([])
const pending = ref(false)
const listError = ref(false)
const formError = ref<string | null>(null)
const saving = ref(false)

// null = nothing open, "new" = creating, otherwise the row being edited.
const editing = ref<Row | "new" | null>(null)
const form = ref<Record<string, unknown>>({})

const optionsByField = ref<Record<string, Array<{ value: string; label: string }>>>({})

function blank(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of props.fields) {
    out[f.key] = f.type === "checkbox" ? false : f.type === "number" ? 0 : ""
  }
  return out
}

async function load() {
  pending.value = true
  listError.value = false
  try {
    rows.value = (await api<{ data: Row[] }>(props.endpoint)).data
  } catch {
    listError.value = true
  } finally {
    pending.value = false
  }
}

async function loadOptions() {
  for (const f of props.fields) {
    if (!f.optionsEndpoint) continue
    try {
      const res = await api<{ data: Array<Record<string, unknown>> }>(f.optionsEndpoint)
      optionsByField.value[f.key] = res.data.map((o) => ({
        value: String(o.id),
        label: String(o[f.optionsLabel ?? "name"] ?? o.id),
      }))
    } catch {
      // A missing option list must not take the whole form down: the field
      // simply offers "aucun" until the call succeeds.
      optionsByField.value[f.key] = []
    }
  }
}

await load()
await loadOptions()

function startCreate() {
  editing.value = "new"
  form.value = blank()
  formError.value = null
}

function startEdit(row: Row) {
  editing.value = row
  form.value = Object.fromEntries(props.fields.map((f) => [f.key, row[f.key] ?? (f.type === "checkbox" ? false : "")]))
  formError.value = null
}

function cancel() {
  editing.value = null
  formError.value = null
}

/**
 * Empty strings are dropped rather than sent: the API's optional fields reject
 * "" for a URL, and a blank box means "not filled in", not "set it to empty".
 */
function payload(isCreate: boolean) {
  const out: Record<string, unknown> = {}
  for (const f of props.fields) {
    if (!isCreate && f.createOnly) continue
    const v = form.value[f.key]
    if (typeof v === "string" && v.trim() === "") continue
    out[f.key] = f.type === "number" ? Number(v) : v
  }
  return out
}

function messageFrom(err: unknown): string {
  const body = (err as { data?: { message?: string; issues?: Array<{ path: string; message: string }> } }).data
  if (body?.issues?.length) return body.issues.map((i) => `${i.path} : ${i.message}`).join(" · ")
  if (body?.message) return body.message
  return "L'enregistrement a échoué."
}

async function save() {
  saving.value = true
  formError.value = null
  const isCreate = editing.value === "new"
  try {
    if (isCreate) {
      await api(props.endpoint, { method: "POST", body: payload(true) })
    } else {
      const row = editing.value as Row
      await api(`${props.endpoint}/${row.id}`, { method: "PATCH", body: payload(false) })
    }
    await load()
    editing.value = null
  } catch (err) {
    formError.value = messageFrom(err)
  } finally {
    saving.value = false
  }
}

async function remove(row: Row) {
  const label = String(row[props.columns[0]?.key ?? "id"] ?? row.id)
  if (!confirm(`Supprimer « ${label} » ? Cette action est définitive.`)) return
  formError.value = null
  try {
    await api(`${props.endpoint}/${row.id}`, { method: "DELETE" })
    await load()
    if (editing.value !== "new" && (editing.value as Row | null)?.id === row.id) editing.value = null
  } catch (err) {
    formError.value = messageFrom(err)
  }
}

function optionsFor(f: AdminField) {
  return f.options ?? optionsByField.value[f.key] ?? []
}

const editableFields = computed(() => props.fields.filter((f) => editing.value === "new" || !f.createOnly))
</script>

<template>
  <div>
    <header class="head">
      <div>
        <p class="eyebrow">Catalogue</p>
        <h1>{{ title }}</h1>
      </div>
      <button class="btn-add" type="button" @click="startCreate">+ {{ newLabel }}</button>
    </header>

    <p v-if="intro" class="intro">{{ intro }}</p>

    <p v-if="pending" class="state">Chargement…</p>
    <p v-else-if="listError" class="state state--error">Impossible de charger la liste.</p>

    <section v-else class="panel">
      <p v-if="rows.length === 0" class="state">{{ emptyLabel }}</p>
      <div v-else class="tablewrap">
        <table class="grid">
          <thead>
            <tr>
              <th v-for="c in columns" :key="c.key" scope="col">{{ c.label }}</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id" :class="{ 'row--on': editing !== 'new' && (editing as any)?.id === row.id }">
              <td v-for="c in columns" :key="c.key" :class="{ 'cell--num': c.numeric }">
                <template v-if="typeof row[c.key] === 'boolean'">{{ row[c.key] ? "Oui" : "Non" }}</template>
                <template v-else>{{ row[c.key] ?? "—" }}</template>
              </td>
              <td class="cell--actions">
                <button class="link" type="button" @click="startEdit(row)">Modifier</button>
                <button class="link link--danger" type="button" @click="remove(row)">Supprimer</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="editing" class="panel form" aria-labelledby="form-h">
      <h2 id="form-h" class="panel__title">
        {{ editing === "new" ? newLabel : `Modifier « ${(editing as any)[columns[0]?.key ?? "id"]} »` }}
      </h2>

      <p v-if="formError" class="alert" role="alert">{{ formError }}</p>

      <div class="fields">
        <label v-for="f in editableFields" :key="f.key" class="field" :class="{ 'field--wide': f.type === 'textarea' }">
          <span class="field__label">{{ f.label }}<span v-if="f.required" aria-hidden="true"> *</span></span>

          <textarea v-if="f.type === 'textarea'" v-model="form[f.key] as string" class="ctl ctl--area" rows="4" />

          <select v-else-if="f.type === 'select'" v-model="form[f.key] as string" class="ctl">
            <option value="">— aucun —</option>
            <option v-for="o in optionsFor(f)" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>

          <input v-else-if="f.type === 'checkbox'" v-model="form[f.key] as boolean" type="checkbox" class="check" >

          <input
            v-else
            v-model="form[f.key] as string"
            :type="f.type === 'number' ? 'number' : 'text'"
            class="ctl"
          >

          <span v-if="f.help" class="field__help">{{ f.help }}</span>
        </label>
      </div>

      <AdminMediaGallery
        v-if="mediaOwnerType"
        :owner-type="mediaOwnerType"
        :owner-id="editing === 'new' ? null : (editing as any).id"
      />

      <div class="actions">
        <button class="btn btn-primary" type="button" :disabled="saving" @click="save">
          {{ saving ? "Enregistrement…" : "Enregistrer" }}
        </button>
        <button class="btn btn-ghost" type="button" @click="cancel">Annuler</button>
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
  margin-bottom: 1rem;
}
.eyebrow {
  margin: 0;
  font-size: 0.72rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--paper-faint);
}
h1 {
  margin: 0.3rem 0 0;
  font-size: clamp(1.9rem, 5vw, 2.6rem);
}
.intro {
  max-width: 72ch;
  margin: 0 0 1.5rem;
  color: var(--paper-dim);
  font-size: 0.9rem;
  line-height: 1.7;
}
.btn-add {
  padding: 0.55rem 1rem;
  background: transparent;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper-dim);
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}
.btn-add:hover {
  border-color: var(--brass);
  color: var(--brass);
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
.tablewrap {
  overflow-x: auto;
}
.grid {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}
.grid th,
.grid td {
  padding: 0.55rem 0.7rem;
  border-bottom: 1px solid var(--ink-line);
  text-align: left;
}
.grid thead th {
  color: var(--paper-faint);
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  white-space: nowrap;
}
.cell--num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--paper-dim);
}
.cell--actions {
  text-align: right;
  white-space: nowrap;
}
.row--on {
  background: rgba(200, 163, 91, 0.07);
}
.link {
  background: none;
  border: 0;
  color: var(--paper-dim);
  font: inherit;
  font-size: 0.82rem;
  cursor: pointer;
  padding: 0 0 0 0.8rem;
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
  font-size: 0.88rem;
}
.fields {
  display: grid;
  gap: 1.1rem;
  grid-template-columns: 1fr;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
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
.ctl--area {
  line-height: 1.6;
  resize: vertical;
}
.check {
  width: 1.1rem;
  height: 1.1rem;
  accent-color: var(--brass);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.8rem;
  margin-top: 1.6rem;
}
.state {
  color: var(--paper-dim);
  padding: 1.5rem 0;
}
.state--error {
  color: var(--danger);
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

@media (min-width: 720px) {
  .fields {
    grid-template-columns: 1fr 1fr;
  }
  .field--wide {
    grid-column: 1 / -1;
  }
}
</style>
