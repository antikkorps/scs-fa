<script setup lang="ts">
import { buildArtworkPriceGrid } from "@armurier/shared"
import type { AdminArtworkDetail, AdminArtworkFormat } from "~/types/admin-catalogue"
import { formatEuros } from "~/utils/format"

definePageMeta({ layout: "admin", middleware: "admin" })

const route = useRoute()
const api = useApi()
// One page for both: "nouvelle" is the create route, anything else is an id.
const isNew = computed(() => route.params.id === "nouvelle")
const id = computed(() => route.params.id as string)

useHead({ title: () => `${isNew.value ? "Nouvelle œuvre" : "Modifier une œuvre"} — Administration SCS` })

const DEFAULT_FORMATS: AdminArtworkFormat[] = [
  { id: "petit", name: "Petit (40 × 50 cm)", widthCm: 40, heightCm: 50, priceFactor: 1 },
  { id: "moyen", name: "Moyen (60 × 80 cm)", widthCm: 60, heightCm: 80, priceFactor: 2 },
  { id: "grand", name: "Grand (100 × 100 cm)", widthCm: 100, heightCm: 100, priceFactor: 3 },
]

const form = reactive({
  sku: "",
  slug: "",
  title: "",
  description: "",
  longDescription: "",
  artistId: "",
  seriesId: "",
  seriesOrder: 0,
  editionLimit: 25,
  editionYear: new Date().getFullYear(),
  // A deep copy: spreading the array alone shares the objects, so editing the
  // formats of a new artwork would rewrite the template for the whole session.
  availableFormats: DEFAULT_FORMATS.map((f) => ({ ...f })) as AdminArtworkFormat[],
  basePriceHt: 50,
  priceIncrementHt: 2,
  vatPct: 20,
  orientation: "portrait" as "portrait" | "landscape" | "square",
  includeCertificate: true,
  featuredImageUrl: "",
  published: false,
  featured: false,
  metaTitle: "",
  metaDescription: "",
})

const prints = ref<AdminArtworkDetail["prints"]>([])
const loadError = ref(false)
const saveError = ref<string | null>(null)
const saving = ref(false)

const { data: artistsData } = await useAsyncData("admin-artists-opts", () =>
  api<{ data: Array<{ id: string; name: string }> }>("/admin/gun-art/artists"),
)
const { data: seriesData } = await useAsyncData("admin-series-opts", () =>
  api<{ data: Array<{ id: string; title: string }> }>("/admin/gun-art/series"),
)
const artistOptions = computed(() => artistsData.value?.data ?? [])
const seriesOptions = computed(() => seriesData.value?.data ?? [])

async function load() {
  if (isNew.value) return
  try {
    const res = await api<{ data: AdminArtworkDetail }>(`/admin/artworks/${id.value}`)
    const d = res.data
    Object.assign(form, {
      sku: d.sku,
      slug: d.slug,
      title: d.title,
      description: d.description ?? "",
      longDescription: d.longDescription ?? "",
      artistId: d.artistId ?? "",
      seriesId: d.seriesId ?? "",
      seriesOrder: d.seriesOrder ?? 0,
      editionLimit: d.editionLimit,
      editionYear: d.editionYear ?? new Date().getFullYear(),
      availableFormats: d.availableFormats,
      basePriceHt: d.basePriceHt,
      priceIncrementHt: d.priceIncrementHt,
      vatPct: d.vatPct,
      orientation: d.orientation,
      includeCertificate: d.includeCertificate ?? true,
      featuredImageUrl: d.featuredImageUrl ?? "",
      published: d.published,
      featured: d.featured,
      metaTitle: d.metaTitle ?? "",
      metaDescription: d.metaDescription ?? "",
    })
    prints.value = d.prints
  } catch {
    loadError.value = true
  }
}
await load()

/**
 * The 11.7 guard rail, run locally as the admin types.
 *
 * The server enforces the same rule on save — this is not a substitute for it,
 * only the difference between finding out now and finding out after a refused
 * submit. Both call the very same function from `@armurier/shared`.
 */
const grid = computed(() => {
  try {
    return buildArtworkPriceGrid(
      Number(form.basePriceHt) || 0,
      Number(form.priceIncrementHt) || 0,
      Number(form.editionLimit) || 1,
      form.availableFormats,
      Number(form.vatPct) || 0,
    )
  } catch {
    return null
  }
})

function addFormat() {
  if (form.availableFormats.length >= 10) return
  const last = form.availableFormats.at(-1)
  form.availableFormats.push({
    id: `format-${form.availableFormats.length + 1}`,
    name: `Format ${form.availableFormats.length + 1}`,
    widthCm: 100,
    heightCm: 100,
    priceFactor: Number(((last?.priceFactor ?? 1) + 1).toFixed(2)),
  })
}
function removeFormat(index: number) {
  if (form.availableFormats.length <= 1) return
  form.availableFormats.splice(index, 1)
}

function payload() {
  const body: Record<string, unknown> = {
    title: form.title,
    artistId: form.artistId || null,
    seriesId: form.seriesId || null,
    seriesOrder: Number(form.seriesOrder) || 0,
    editionYear: Number(form.editionYear) || null,
    availableFormats: form.availableFormats.map((f) => ({
      id: f.id,
      name: f.name,
      widthCm: Number(f.widthCm),
      heightCm: Number(f.heightCm),
      priceFactor: Number(f.priceFactor),
    })),
    basePriceHt: Number(form.basePriceHt),
    priceIncrementHt: Number(form.priceIncrementHt),
    vatPct: Number(form.vatPct),
    orientation: form.orientation,
    includeCertificate: form.includeCertificate,
    published: form.published,
    featured: form.featured,
  }
  // `featuredImageUrl` is written by the server from the gallery's position 0 —
  // sending it from here would put back the second source of truth.
  for (const key of ["description", "longDescription", "metaTitle", "metaDescription"] as const) {
    if (form[key].trim()) body[key] = form[key]
  }
  if (isNew.value) {
    body.sku = form.sku
    body.slug = form.slug
    body.editionLimit = Number(form.editionLimit)
  }
  return body
}

function messageFrom(err: unknown): string {
  const body = (err as { data?: { message?: string; issues?: Array<{ path: string; message: string }> } }).data
  if (body?.issues?.length) return body.issues.map((i) => i.message).join(" · ")
  return body?.message ?? "L'enregistrement a échoué."
}

async function save() {
  saving.value = true
  saveError.value = null
  try {
    if (isNew.value) {
      const res = await api<{ data: AdminArtworkDetail }>("/admin/artworks", { method: "POST", body: payload() })
      await navigateTo(`/admin/gun-art/oeuvres/${res.data.id}`)
    } else {
      const res = await api<{ data: AdminArtworkDetail }>(`/admin/artworks/${id.value}`, {
        method: "PATCH",
        body: payload(),
      })
      prints.value = res.data.prints
    }
  } catch (err) {
    saveError.value = messageFrom(err)
  } finally {
    saving.value = false
  }
}

async function reformat(printId: string, formatId: string) {
  saveError.value = null
  try {
    const res = await api<{ data: AdminArtworkDetail }>(`/admin/artworks/${id.value}/prints/${printId}`, {
      method: "PATCH",
      body: { formatId },
    })
    prints.value = res.data.prints
  } catch (err) {
    saveError.value = messageFrom(err)
  }
}

const PRINT_STATUS: Record<string, string> = {
  available: "Disponible",
  in_cart: "Dans un panier",
  reserved: "Réservé",
  sold: "Vendu",
  cancelled: "Annulé",
}
</script>

<template>
  <div>
    <header class="head">
      <div>
        <p class="eyebrow">
          <NuxtLink to="/admin/gun-art/oeuvres" class="back">Œuvres</NuxtLink>
        </p>
        <h1>{{ isNew ? "Nouvelle œuvre" : form.title || "Œuvre" }}</h1>
      </div>
      <button class="btn btn-primary" type="button" :disabled="saving" @click="save">
        {{ saving ? "Enregistrement…" : "Enregistrer" }}
      </button>
    </header>

    <p v-if="loadError" class="alert" role="alert">Impossible de charger cette œuvre.</p>
    <p v-if="saveError" class="alert" role="alert">{{ saveError }}</p>

    <section class="panel">
      <h2 class="panel__title">Identité</h2>
      <div class="fields">
        <label class="field">
          <span class="field__label">SKU *</span>
          <input v-model="form.sku" class="ctl" :disabled="!isNew" >
          <span v-if="!isNew" class="field__help">Définitif après création.</span>
        </label>
        <label class="field">
          <span class="field__label">Slug (URL) *</span>
          <input v-model="form.slug" class="ctl" :disabled="!isNew" >
          <span v-if="!isNew" class="field__help">Définitif : il est indexé.</span>
        </label>
        <label class="field field--wide">
          <span class="field__label">Titre *</span>
          <input v-model="form.title" class="ctl" >
        </label>
        <label class="field field--wide">
          <span class="field__label">Description courte</span>
          <textarea v-model="form.description" class="ctl ctl--area" rows="2" />
        </label>
        <label class="field field--wide">
          <span class="field__label">Description longue</span>
          <textarea v-model="form.longDescription" class="ctl ctl--area" rows="5" />
        </label>
      </div>
    </section>

    <section class="panel">
      <h2 class="panel__title">Rattachement éditorial</h2>
      <div class="fields">
        <label class="field">
          <span class="field__label">Artiste</span>
          <select v-model="form.artistId" class="ctl">
            <option value="">— aucun —</option>
            <option v-for="a in artistOptions" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </label>
        <label class="field">
          <span class="field__label">Série</span>
          <select v-model="form.seriesId" class="ctl">
            <option value="">— aucune —</option>
            <option v-for="s in seriesOptions" :key="s.id" :value="s.id">{{ s.title }}</option>
          </select>
        </label>
        <label class="field">
          <span class="field__label">Rang dans la série</span>
          <input v-model.number="form.seriesOrder" type="number" min="0" class="ctl" >
          <span class="field__help">Une série se lit dans l'ordre voulu, pas par date.</span>
        </label>
        <label class="field">
          <span class="field__label">Orientation</span>
          <select v-model="form.orientation" class="ctl">
            <option value="portrait">Portrait</option>
            <option value="landscape">Paysage</option>
            <option value="square">Carré</option>
          </select>
        </label>
      </div>
    </section>

    <section class="panel">
      <h2 class="panel__title">Édition & prix</h2>
      <div class="fields">
        <label class="field">
          <span class="field__label">Nombre de tirages *</span>
          <input v-model.number="form.editionLimit" type="number" min="1" max="250" class="ctl" :disabled="!isNew" >
          <span class="field__help">
            {{ isNew
              ? "Tous formats confondus, pas par format. Définitif : les tirages sont numérotés à la création."
              : "Définitif : l'édition est numérotée et partiellement vendue." }}
          </span>
        </label>
        <label class="field">
          <span class="field__label">Année</span>
          <input v-model.number="form.editionYear" type="number" class="ctl" >
        </label>
        <label class="field">
          <span class="field__label">Prix de base HT (€) *</span>
          <input v-model.number="form.basePriceHt" type="number" min="0" step="1" class="ctl" >
        </label>
        <label class="field">
          <span class="field__label">Incrément par tirage restant HT (€) *</span>
          <input v-model.number="form.priceIncrementHt" type="number" min="0" step="0.01" class="ctl" >
        </label>
        <label class="field">
          <span class="field__label">TVA (%)</span>
          <input v-model.number="form.vatPct" type="number" min="0" max="100" step="0.1" class="ctl" >
        </label>
        <label class="field field--check">
          <input v-model="form.includeCertificate" type="checkbox" class="check" >
          <span>Certificat d'authenticité inclus</span>
        </label>
      </div>

      <h3 class="sub">Formats</h3>
      <div v-for="(f, i) in form.availableFormats" :key="i" class="format">
        <label class="field">
          <span class="field__label">Identifiant</span>
          <input v-model="f.id" class="ctl" >
        </label>
        <label class="field">
          <span class="field__label">Nom</span>
          <input v-model="f.name" class="ctl" >
        </label>
        <label class="field">
          <span class="field__label">Largeur (cm)</span>
          <input v-model.number="f.widthCm" type="number" min="1" class="ctl" >
        </label>
        <label class="field">
          <span class="field__label">Hauteur (cm)</span>
          <input v-model.number="f.heightCm" type="number" min="1" class="ctl" >
        </label>
        <label class="field">
          <span class="field__label">Facteur de prix</span>
          <input v-model.number="f.priceFactor" type="number" min="0.01" step="0.05" class="ctl" >
        </label>
        <button
          class="remove"
          type="button"
          :disabled="form.availableFormats.length <= 1"
          :aria-label="`Supprimer le format ${f.name}`"
          @click="removeFormat(i)"
        >
          ✕
        </button>
      </div>
      <button class="add" type="button" :disabled="form.availableFormats.length >= 10" @click="addFormat">
        + Ajouter un format
      </button>

      <div v-if="grid" class="verdict" :class="grid.valid ? 'verdict--ok' : 'verdict--bad'" aria-live="polite">
        <p class="verdict__head">
          {{ grid.valid
            ? "Grille cohérente : aucun petit format ne dépasse un format supérieur."
            : "Grille incohérente : l'enregistrement sera refusé." }}
        </p>
        <ul v-if="!grid.valid" class="verdict__list">
          <li v-for="o in grid.overlaps" :key="`${o.lowerFormatId}-${o.upperFormatId}`">
            <strong>{{ o.lowerFormatName }}</strong> monte à {{ formatEuros(o.lowerMaxPriceHt) }} HT alors que
            <strong>{{ o.upperFormatName }}</strong> démarre à {{ formatEuros(o.upperMinPriceHt) }} HT. Incrément
            ≤ {{ formatEuros(o.maxIncrementHt) }} HT, ou facteur ≥ {{ o.minUpperPriceFactor }}.
          </li>
        </ul>
        <p class="verdict__link">
          <NuxtLink to="/admin/gun-art/simulateur-prix">Ouvrir le simulateur complet</NuxtLink>
        </p>
      </div>
    </section>

    <section class="panel">
      <h2 class="panel__title">Publication</h2>
      <div class="fields">
        <label class="field field--check">
          <input v-model="form.published" type="checkbox" class="check" >
          <span>Publiée sur le site</span>
        </label>
        <label class="field field--check">
          <input v-model="form.featured" type="checkbox" class="check" >
          <span>Mise en avant</span>
        </label>
        <label class="field">
          <span class="field__label">Titre SEO</span>
          <input v-model="form.metaTitle" class="ctl" >
        </label>
        <label class="field field--wide">
          <span class="field__label">Description SEO</span>
          <textarea v-model="form.metaDescription" class="ctl ctl--area" rows="2" />
        </label>
      </div>
    </section>

    <section class="panel">
      <AdminMediaGallery owner-type="artwork" :owner-id="isNew ? null : id" />
    </section>

    <section v-if="!isNew && prints.length > 0" class="panel">
      <h2 class="panel__title">Tirages ({{ prints.length }})</h2>
      <p class="note">
        Un tirage vendu ou réservé garde son prix : c'est ce qui a été promis à l'acheteur. Seuls les tirages
        disponibles suivent un changement de prix ou de format.
      </p>
      <div class="tablewrap">
        <table class="grid">
          <thead>
            <tr>
              <th scope="col">N°</th>
              <th scope="col">Statut</th>
              <th scope="col">Format</th>
              <th scope="col">Prix HT</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in prints" :key="p.id">
              <th scope="row">{{ p.printDesignation }}</th>
              <td>{{ PRINT_STATUS[p.status] ?? p.status }}</td>
              <td>
                <select
                  v-if="p.status === 'available'"
                  class="ctl ctl--inline"
                  :value="p.formatId"
                  @change="reformat(p.id, ($event.target as HTMLSelectElement).value)"
                >
                  <option v-for="f in form.availableFormats" :key="f.id" :value="f.id">{{ f.name }}</option>
                </select>
                <span v-else>{{ form.availableFormats.find((f) => f.id === p.formatId)?.name ?? p.formatId }}</span>
              </td>
              <td class="cell--num">{{ formatEuros(p.priceHt) }}</td>
            </tr>
          </tbody>
        </table>
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
.panel__title,
.sub {
  margin: 0 0 1.1rem;
  font-size: 0.72rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--paper-faint);
}
.sub {
  margin-top: 1.8rem;
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
.ctl--inline {
  padding: 0.3rem 0.5rem;
  font-size: 0.85rem;
  width: auto;
}
.check {
  width: 1.1rem;
  height: 1.1rem;
  accent-color: var(--brass);
}
.format {
  display: grid;
  gap: 0.8rem;
  grid-template-columns: 1fr;
  padding-bottom: 1rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--ink-line);
  align-items: end;
}
.remove,
.add {
  padding: 0.55rem 0.9rem;
  background: transparent;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper-dim);
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}
.remove:disabled,
.add:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.verdict {
  margin-top: 1.6rem;
  padding: 1rem 1.2rem;
  border-radius: var(--radius);
  border: 1px solid var(--ink-line);
  border-left-width: 3px;
  background: var(--ink);
  font-size: 0.88rem;
}
.verdict--ok {
  border-left-color: var(--brass);
}
.verdict--bad {
  border-left-color: var(--danger);
}
.verdict__head {
  margin: 0;
  font-weight: 600;
}
.verdict--ok .verdict__head {
  color: var(--brass);
}
.verdict--bad .verdict__head {
  color: var(--danger);
}
.verdict__list {
  margin: 0.6rem 0 0;
  padding-left: 1.1rem;
  color: var(--paper-dim);
  line-height: 1.7;
}
.verdict__link {
  margin: 0.7rem 0 0;
}
.verdict__link a {
  color: var(--brass);
  font-size: 0.82rem;
}
.note {
  margin: 0 0 1rem;
  font-size: 0.8rem;
  color: var(--paper-faint);
  line-height: 1.6;
}
.tablewrap {
  overflow-x: auto;
}
.grid {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.86rem;
}
.grid th,
.grid td {
  padding: 0.45rem 0.7rem;
  border-bottom: 1px solid var(--ink-line);
  text-align: left;
}
.grid thead th {
  color: var(--paper-faint);
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.cell--num {
  text-align: right;
  font-variant-numeric: tabular-nums;
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
  .format {
    grid-template-columns: minmax(90px, 0.8fr) minmax(120px, 1.4fr) repeat(3, minmax(80px, 0.8fr)) auto;
  }
}
</style>
