<script setup lang="ts">
import { slugify } from "@armurier/shared"
import type {
  CatalogExportSupplier,
  CatalogFailedImage,
  CatalogImportHistoryRow,
  CatalogImportPreview,
  CatalogImportResult,
} from "~/types/admin"
import {
  filterPreviewRows,
  IMPORT_ACTION_META,
  PREVIEW_FILTERS,
  type PreviewFilter,
  plural,
  previewFilterCounts,
} from "~/utils/catalogImport"
import { formatDateTime } from "~/utils/format"

definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Import de catalogues — Administration SCS" })

const api = useApi()
const apiMessage = (err: unknown, fallback: string) =>
  (err as { data?: { message?: string } })?.data?.message ?? fallback

// --- Step 1: file + preview --------------------------------------------------

// --- Step 0: export (story 12.4) ----------------------------------------------

const exporting = ref(false)
const exportError = ref("")
// One supplier's file keeps the same flow as the triage files: sort, import,
// and "archive what is missing" only ever touches that supplier.
const exportSupplier = ref("")
const { data: suppliersData } = await useAsyncData(
  "admin-catalog-export-suppliers",
  () => api<{ data: CatalogExportSupplier[] }>("/admin/catalog-imports/suppliers"),
  { server: false },
)
const exportSuppliers = computed(() => suppliersData.value?.data ?? [])

/** Download the catalogue in the import's columns, to edit in Excel and bring back. */
async function runExport() {
  exporting.value = true
  exportError.value = ""
  try {
    const chosen = exportSuppliers.value.find((s) => s.id === exportSupplier.value)
    const blob = await api<Blob>("/admin/catalog-imports/export", {
      responseType: "blob",
      query: chosen ? { supplierId: chosen.id } : {},
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    const label = chosen ? `${slugify(chosen.name, 40)}-` : ""
    a.download = `catalogue-${label}${new Date().toISOString().slice(0, 10)}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    exportError.value = apiMessage(err, "Export impossible.")
  } finally {
    exporting.value = false
  }
}

const file = ref<File | null>(null)
const overwrite = ref(false)
const archiveMissing = ref(false)
const previewing = ref(false)
const previewError = ref("")
const preview = ref<CatalogImportPreview | null>(null)
const filter = ref<PreviewFilter>("all")
// A preview of 5 000 lines would make a sluggish page: show them in pages.
const PAGE = 200
const shown = ref(PAGE)

function onFile(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null
  preview.value = null
  result.value = null
}

function formFor(extra: Record<string, string> = {}) {
  const body = new FormData()
  body.append("overwrite", String(overwrite.value))
  body.append("archiveMissing", String(archiveMissing.value))
  for (const [k, v] of Object.entries(extra)) body.append(k, v)
  if (file.value) body.append("file", file.value)
  return body
}

async function runPreview() {
  if (!file.value) {
    previewError.value = "Choisissez d'abord un fichier .xlsx ou .csv."
    return
  }
  previewing.value = true
  previewError.value = ""
  preview.value = null
  result.value = null
  try {
    const res = await api<{ data: CatalogImportPreview }>("/admin/catalog-imports/preview", {
      method: "POST",
      body: formFor(),
    })
    preview.value = res.data
    filter.value = res.data.summary.invalid > 0 ? "invalid" : "all"
    shown.value = PAGE
  } catch (err) {
    previewError.value = apiMessage(err, "Lecture du fichier impossible.")
  } finally {
    previewing.value = false
  }
}

// Changing an option changes the plan: the preview is stale.
watch([overwrite, archiveMissing], () => {
  if (preview.value) preview.value = null
})

const counts = computed(() => previewFilterCounts(preview.value?.rows ?? []))
const filtered = computed(() => filterPreviewRows(preview.value?.rows ?? [], filter.value))
const toWrite = computed(() => (preview.value ? preview.value.summary.create + preview.value.summary.update : 0))
const toArchive = computed(() => preview.value?.summary.archive ?? 0)
const commitLabel = computed(() => {
  const parts = [
    toWrite.value > 0 ? `Importer ${plural(toWrite.value, "produit")}` : "",
    toArchive.value > 0
      ? `${toWrite.value > 0 ? "et archiver" : "Archiver"} ${plural(toArchive.value, "produit")}`
      : "",
  ]
  return parts.filter(Boolean).join(" ")
})

// --- Step 2: commit ----------------------------------------------------------

const committing = ref(false)
const commitError = ref("")
const result = ref<CatalogImportResult | null>(null)

async function runCommit() {
  if (!preview.value || toWrite.value + toArchive.value === 0) return
  committing.value = true
  commitError.value = ""
  try {
    const res = await api<{ data: CatalogImportResult }>("/admin/catalog-imports", {
      method: "POST",
      body: formFor({ expectedSha256: preview.value.fileSha256 }),
    })
    result.value = res.data
    preview.value = null
    await refreshHistory()
  } catch (err) {
    commitError.value = apiMessage(err, "L'import a échoué : rien n'a été écrit.")
  } finally {
    committing.value = false
  }
}

// --- History & image queue ---------------------------------------------------

const {
  data: history,
  pending: historyPending,
  error: historyError,
  refresh: refreshHistory,
} = await useAsyncData(
  "admin-catalog-imports",
  () => api<{ data: CatalogImportHistoryRow[] }>("/admin/catalog-imports"),
  {
    server: false,
  },
)
const imports = computed(() => history.value?.data ?? [])

// While images are still downloading, keep the counters moving.
let timer: ReturnType<typeof setInterval> | undefined
watchEffect(() => {
  const downloading = imports.value.some((i) => i.images.pending > 0)
  if (downloading && !timer) timer = setInterval(() => refreshHistory(), 10_000)
  if (!downloading && timer) {
    clearInterval(timer)
    timer = undefined
  }
})
onBeforeUnmount(() => clearInterval(timer))

const openFailures = ref<string | null>(null)
const failures = ref<CatalogFailedImage[]>([])
const failuresError = ref("")

async function toggleFailures(id: string) {
  if (openFailures.value === id) {
    openFailures.value = null
    return
  }
  openFailures.value = id
  failures.value = []
  failuresError.value = ""
  try {
    failures.value = (await api<{ data: CatalogFailedImage[] }>(`/admin/catalog-imports/${id}/failed-images`)).data
  } catch (err) {
    failuresError.value = apiMessage(err, "Chargement impossible.")
  }
}

async function retry(id: string) {
  try {
    await api(`/admin/catalog-imports/${id}/retry-images`, { method: "POST" })
    openFailures.value = null
    await refreshHistory()
  } catch (err) {
    failuresError.value = apiMessage(err, "Relance impossible.")
  }
}
</script>

<template>
  <div>
    <header class="head">
      <div>
        <p class="eyebrow">Catalogue</p>
        <h1>Import de catalogues fournisseurs</h1>
      </div>
    </header>

    <section class="panel" aria-labelledby="step-export">
      <h2 id="step-export" class="panel__title">Modifier le catalogue dans Excel</h2>
      <p class="hint">
        Téléchargez le catalogue dans les colonnes de l'import : modifiez prix et textes, ajoutez des lignes, passez
        <em>Actif</em> à « oui » ou « non » (même produit chez deux fournisseurs : une ligne active, l'autre non), puis
        déposez le fichier ci-dessous. Le stock n'y figure pas : un fichier ne le modifie jamais.
      </p>
      <div class="actions">
        <label class="sr-only" for="export-supplier">Fournisseur à exporter</label>
        <select id="export-supplier" v-model="exportSupplier" class="select">
          <option value="">Tous les fournisseurs</option>
          <option v-for="s in exportSuppliers" :key="s.id" :value="s.id">
            {{ s.name }} ({{ plural(s.products, "produit") }})
          </option>
        </select>
        <button class="btn btn-ghost" type="button" :disabled="exporting" @click="runExport">
          {{ exporting ? "Préparation…" : "Exporter le catalogue (.xlsx)" }}
        </button>
        <span v-if="exportError" class="err" role="alert">{{ exportError }}</span>
      </div>
    </section>

    <section class="panel" aria-labelledby="step-file">
      <h2 id="step-file" class="panel__title">1. Fichier</h2>
      <p class="hint">
        Déposez le fichier de tri ou le catalogue exporté (<strong>.xlsx</strong> ou <strong>.csv</strong>). Seules les
        lignes marquées « oui » dans la colonne <em>Importer</em> sont prises en compte. Rien n'est écrit avant votre
        confirmation.
      </p>
      <div class="pick">
        <input
          id="catalog-file"
          class="pick__input"
          type="file"
          accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          @change="onFile"
        />
        <label class="check">
          <input v-model="overwrite" type="checkbox" />
          <span>
            Écraser les fiches existantes
            <small>Sinon, un produit déjà importé ne reçoit que les champs encore vides : vos retouches sont gardées.</small>
          </span>
        </label>
        <label class="check">
          <input v-model="archiveMissing" type="checkbox" />
          <span>
            Archiver les produits absents du fichier
            <small>
              Seulement pour les fournisseurs présents dans le fichier. Un produit archivé est retiré de la vente, jamais
              effacé, et se réactive depuis l'écran Produits. La liste exacte s'affiche avant confirmation.
            </small>
          </span>
        </label>
      </div>
      <div class="actions">
        <button class="btn btn-primary" type="button" :disabled="previewing || !file" @click="runPreview">
          {{ previewing ? "Lecture…" : "Prévisualiser" }}
        </button>
        <span v-if="previewError" class="err" role="alert">{{ previewError }}</span>
      </div>
    </section>

    <section v-if="result" class="panel panel--done" aria-live="polite">
      <h2 class="panel__title">Import terminé</h2>
      <p>
        <strong>{{ plural(result.created, "produit créé", "produits créés") }}</strong>,
        {{ plural(result.updated, "produit mis à jour", "produits mis à jour") }}<template v-if="result.archived">,
          {{ plural(result.archived, "produit archivé", "produits archivés") }}</template><template v-if="result.suppliersCreated">,
          {{ plural(result.suppliersCreated, "nouveau fournisseur", "nouveaux fournisseurs") }}</template>.
        Les produits créés sans « Actif = oui » sont <strong>hors ligne</strong> : publiez-les une fois relus.
      </p>
      <p v-if="result.imagesQueued" class="hint">
        {{ plural(result.imagesQueued, "image", "images") }} en cours de téléchargement — suivi dans l'historique
        ci-dessous.
      </p>
    </section>

    <section v-if="preview" class="panel" aria-labelledby="step-preview">
      <h2 id="step-preview" class="panel__title">2. Vérification — {{ preview.fileName }}</h2>

      <ul class="stats">
        <li><span class="stats__n ok">{{ preview.summary.create }}</span> à créer</li>
        <li><span class="stats__n warn">{{ preview.summary.update }}</span> à mettre à jour</li>
        <li><span class="stats__n bad">{{ preview.summary.invalid }}</span> en erreur</li>
        <li><span class="stats__n">{{ preview.summary.skipped }}</span> non retenues</li>
        <li><span class="stats__n">{{ preview.summary.images }}</span> images</li>
        <li v-if="preview.summary.publish"><span class="stats__n ok">{{ preview.summary.publish }}</span> mis en ligne</li>
        <li v-if="preview.summary.unpublish">
          <span class="stats__n warn">{{ preview.summary.unpublish }}</span> retirés de la vente
        </li>
        <li v-if="preview.archiveMissing"><span class="stats__n bad">{{ preview.summary.archive }}</span> à archiver</li>
      </ul>

      <details v-if="preview.summary.archive" class="notice archive" open>
        <summary>
          ⚠️ {{ plural(preview.summary.archive, "produit absent du fichier sera archivé", "produits absents du fichier seront archivés") }}
          (retirés de la vente, réactivables depuis l'écran Produits)
        </summary>
        <ul>
          <li v-for="a in preview.toArchive" :key="a.id">
            {{ a.supplier }} · <span class="mono">{{ a.supplierSku }}</span> — {{ a.name }}
          </li>
        </ul>
        <p v-if="preview.summary.archive > preview.toArchive.length" class="hint">
          … et {{ preview.summary.archive - preview.toArchive.length }} autres.
        </p>
      </details>

      <p v-if="preview.suppliersToCreate.length" class="notice">
        ⚠️ Fournisseurs qui seront <strong>créés</strong> : {{ preview.suppliersToCreate.join(", ") }}. Une faute de
        frappe dans le nom apparaîtrait ici.
      </p>
      <p v-if="preview.summary.invalid" class="hint">
        Les lignes en erreur sont <strong>laissées de côté</strong>. Corrigez-les dans le fichier et relancez l'import
        plus tard : les produits déjà importés seront mis à jour, jamais dupliqués.
      </p>

      <div class="chips" role="tablist" aria-label="Filtrer les lignes">
        <button
          v-for="f in PREVIEW_FILTERS"
          :key="f.key"
          type="button"
          role="tab"
          class="chip"
          :class="{ 'chip--on': filter === f.key }"
          :aria-selected="filter === f.key"
          @click="
            filter = f.key;
            shown = PAGE
          "
        >
          {{ f.label }} <span class="chip__n">{{ counts[f.key] }}</span>
        </button>
      </div>

      <p v-if="filtered.length === 0" class="state">Aucune ligne pour ce filtre.</p>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th class="num">Ligne</th>
              <th>Action</th>
              <th>Fournisseur</th>
              <th>Réf.</th>
              <th>Produit</th>
              <th>Messages</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in filtered.slice(0, shown)" :key="r.line">
              <td class="num mono">{{ r.line }}</td>
              <td><AdminStatusTag v-bind="IMPORT_ACTION_META[r.action]" /></td>
              <td>{{ r.supplier ?? "—" }}</td>
              <td class="mono">{{ r.supplierSku ?? "—" }}</td>
              <td>
                {{ r.name ?? "—" }}
                <span v-if="r.images" class="sub">{{ plural(r.images, "image") }}</span>
              </td>
              <td class="msgs">
                <span v-for="(e, i) in r.errors" :key="`e${i}`" class="msg msg--bad">{{ e }}</span>
                <span v-for="(w, i) in r.warnings" :key="`w${i}`" class="msg msg--warn">{{ w }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <button v-if="filtered.length > shown" class="btn btn-ghost more" type="button" @click="shown += PAGE">
        Afficher {{ Math.min(PAGE, filtered.length - shown) }} lignes de plus ({{ filtered.length - shown }} restantes)
      </button>

      <div class="actions actions--commit">
        <button
          class="btn btn-primary"
          type="button"
          :disabled="committing || toWrite + toArchive === 0"
          @click="runCommit"
        >
          {{ committing ? "Import en cours…" : commitLabel || "Rien à importer" }}
        </button>
        <span v-if="commitError" class="err" role="alert">{{ commitError }}</span>
      </div>
    </section>

    <section class="panel" aria-labelledby="history">
      <h2 id="history" class="panel__title">Historique</h2>
      <p v-if="historyPending" class="state">Chargement…</p>
      <p v-else-if="historyError" class="state err">Impossible de charger l'historique.</p>
      <p v-else-if="imports.length === 0" class="state">Aucun import pour l'instant.</p>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Fichier</th>
              <th class="num">Créés</th>
              <th class="num">Mis à jour</th>
              <th class="num">Archivés</th>
              <th>Images</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="i in imports" :key="i.id">
              <tr>
                <td>{{ formatDateTime(i.createdAt) }}</td>
                <td>
                  {{ i.fileName }}
                  <span v-if="i.overwrite" class="sub">écrasement</span>
                </td>
                <td class="num">{{ i.createdCount }}</td>
                <td class="num">{{ i.updatedCount }}</td>
                <td class="num">{{ i.archivedCount }}</td>
                <td>
                  <span class="ok">{{ i.images.done }} ok</span>
                  <span v-if="i.images.pending"> · {{ i.images.pending }} en cours</span>
                  <button v-if="i.images.failed" class="link bad" type="button" @click="toggleFailures(i.id)">
                    · {{ i.images.failed }} en échec
                  </button>
                </td>
              </tr>
              <tr v-if="openFailures === i.id">
                <td colspan="6" class="failures">
                  <p v-if="failuresError" class="err">{{ failuresError }}</p>
                  <ul>
                    <li v-for="f in failures" :key="f.id">
                      <NuxtLink :to="`/admin/produits/${f.productId}`">{{ f.productName }}</NuxtLink>
                      <span class="mono sub">{{ f.url }}</span>
                      <span class="msg msg--bad">{{ f.error }}</span>
                    </li>
                  </ul>
                  <button class="btn btn-ghost" type="button" @click="retry(i.id)">Relancer les images en échec</button>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.head {
  margin-bottom: 1.2rem;
}
.head h1 {
  font-size: var(--fs-2xl);
  margin-top: 0.3rem;
}
.panel {
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  padding: 1.2rem 1.3rem;
  margin-bottom: 1.4rem;
}
.panel--done {
  border-color: var(--brass);
}
.panel__title {
  font-size: var(--fs-lg);
  margin: 0 0 0.7rem;
}
.hint {
  color: var(--paper-dim);
  font-size: var(--fs-sm);
  margin: 0 0 0.8rem;
}
.notice {
  font-size: var(--fs-sm);
  border-left: 3px solid #e0b15f;
  padding: 0.5rem 0.8rem;
  margin: 0 0 0.8rem;
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
.select {
  max-width: 100%;
  padding: 0.5rem 0.7rem;
  background: var(--ink);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper);
  font: inherit;
  font-size: var(--fs-sm);
}
.archive summary {
  cursor: pointer;
}
.archive ul {
  max-height: 16rem;
  overflow-y: auto;
  margin: 0.6rem 0 0;
  padding-left: 1.2rem;
}
.pick {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}
.pick__input {
  color: var(--paper-dim);
  font-size: var(--fs-sm);
  max-width: 100%;
}
.check {
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
  font-size: var(--fs-sm);
  cursor: pointer;
}
.check input {
  margin-top: 0.25rem;
}
.check small {
  display: block;
  color: var(--paper-faint);
}
.actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
  margin-top: 0.9rem;
}
.actions--commit {
  border-top: 1px solid var(--ink-line);
  padding-top: 1rem;
  margin-top: 1.2rem;
}
.stats {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem 1.6rem;
  padding: 0;
  margin: 0 0 1rem;
  font-size: var(--fs-sm);
  color: var(--paper-dim);
}
.stats__n {
  display: block;
  font-size: var(--fs-xl);
  font-weight: var(--fw-semibold);
  color: var(--paper);
}
.ok {
  color: var(--brass);
}
.warn {
  color: #e0b15f;
}
.bad,
.err {
  color: var(--danger);
}
.err {
  font-size: var(--fs-sm);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 1rem;
}
.chip {
  background: transparent;
  border: 1px solid var(--ink-line);
  color: var(--paper-dim);
  padding: 0.4rem 0.9rem;
  border-radius: 999px;
  font-size: var(--fs-sm);
  cursor: pointer;
}
.chip--on {
  color: var(--brass);
  border-color: var(--brass);
}
.chip__n {
  opacity: 0.7;
  margin-left: 0.2rem;
}
.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
  min-width: 760px;
}
.table th {
  text-align: left;
  font-size: var(--fs-xs);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--paper-faint);
  font-weight: var(--fw-semibold);
  padding: 0.75rem 0.9rem;
  border-bottom: 1px solid var(--ink-line);
  background: var(--ink);
}
.table td {
  padding: 0.65rem 0.9rem;
  border-bottom: 1px solid var(--ink-line);
  vertical-align: top;
}
.num {
  text-align: right;
}
.mono {
  font-family: ui-monospace, monospace;
}
.sub {
  display: block;
  color: var(--paper-faint);
  font-size: var(--fs-xs);
  word-break: break-all;
}
.msgs {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.msg {
  font-size: var(--fs-xs);
}
.msg--bad {
  color: var(--danger);
}
.msg--warn {
  color: #e0b15f;
}
.more {
  margin-top: 0.8rem;
}
.state {
  color: var(--paper-dim);
  font-size: var(--fs-sm);
}
.link {
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
}
.failures ul {
  list-style: none;
  padding: 0;
  margin: 0 0 0.8rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
</style>
