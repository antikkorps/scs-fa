<script setup lang="ts">
import type { ArtworkPriceGrid } from "@armurier/shared"
import { formatEuros } from "~/utils/format"

definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Simulateur de prix Gun Art — Administration SCS" })

const api = useApi()

interface FormatRow {
  id: string
  name: string
  widthCm: number
  heightCm: number
  priceFactor: number
}

// The client's own starting point (backlog 11.7): 3 to 4 formats from 40x50cm
// to 1m x 1m, 25 prints. These very values break the rule — the simulator opens
// on the problem rather than on a tidy example.
const basePriceHt = ref(50)
const priceIncrementHt = ref(2)
const editionLimit = ref(25)
const vatPct = ref(20)
const formats = ref<FormatRow[]>([
  { id: "petit", name: "Petit", widthCm: 40, heightCm: 50, priceFactor: 1 },
  { id: "moyen", name: "Moyen", widthCm: 60, heightCm: 80, priceFactor: 1.5 },
  { id: "grand", name: "Grand", widthCm: 100, heightCm: 100, priceFactor: 2 },
])

function addFormat() {
  if (formats.value.length >= 10) return
  const n = formats.value.length + 1
  const last = formats.value.at(-1)
  formats.value.push({
    id: `format-${n}-${Math.random().toString(36).slice(2, 7)}`,
    name: `Format ${n}`,
    widthCm: 100,
    heightCm: 100,
    priceFactor: Number(((last?.priceFactor ?? 1) + 0.5).toFixed(2)),
  })
}

function removeFormat(id: string) {
  if (formats.value.length <= 1) return
  formats.value = formats.value.filter((f) => f.id !== id)
}

const payload = computed(() => ({
  basePriceHt: Number(basePriceHt.value) || 0,
  priceIncrementHt: Number(priceIncrementHt.value) || 0,
  editionLimit: Number(editionLimit.value) || 0,
  vatPct: Number(vatPct.value) || 0,
  formats: formats.value.map((f) => ({
    id: f.id,
    name: f.name,
    widthCm: Number(f.widthCm) || 1,
    heightCm: Number(f.heightCm) || 1,
    priceFactor: Number(f.priceFactor) || 0,
  })),
}))

const grid = ref<ArtworkPriceGrid | null>(null)
const pending = ref(false)
const invalidInput = ref(false)
const failed = ref(false)

// The verdict comes from the API, so what the admin sees is exactly what the
// server-side guard rail will answer when story 7.5 saves an artwork.
let timer: ReturnType<typeof setTimeout> | undefined
async function simulate() {
  pending.value = true
  invalidInput.value = false
  failed.value = false
  try {
    const res = await api<{ data: ArtworkPriceGrid }>("/admin/artworks/price-grid", {
      method: "POST",
      body: payload.value,
    })
    grid.value = res.data
  } catch (err) {
    const status = (err as { response?: { status?: number } }).response?.status
    if (status === 400) invalidInput.value = true
    else failed.value = true
  } finally {
    pending.value = false
  }
}

watch(
  payload,
  () => {
    clearTimeout(timer)
    timer = setTimeout(simulate, 300)
  },
  { deep: true, immediate: true },
)
onBeforeUnmount(() => clearTimeout(timer))

const bandById = computed(() => new Map((grid.value?.bands ?? []).map((b) => [b.formatId, b])))
const formatName = (id: string) => bandById.value.get(id)?.formatName ?? id

// Factors are plain numbers, not money — but they still read in French here.
const factorFormatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 })
const formatFactor = (value: number) => (Number.isFinite(value) ? factorFormatter.format(value) : "—")
</script>

<template>
  <div>
    <header class="head">
      <div>
        <p class="eyebrow">Gun Art</p>
        <h1>Simulateur de prix</h1>
      </div>
    </header>

    <p class="intro">
      Le prix d'un tirage vaut <strong>prix de base × facteur du format</strong> plus
      <strong>incrément × (tirages restants)</strong> : plus le numéro est petit, plus l'exemplaire est cher — c'est
      voulu. Le risque est ailleurs : qu'un <strong>petit format</strong> finisse par coûter
      <strong>plus cher qu'un grand</strong>. Réglez vos facteurs ici jusqu'à ce que la grille soit au vert.
    </p>

    <section class="panel">
      <h2 class="panel__title">Paramètres de l'œuvre</h2>
      <div class="fields">
        <label class="field">
          <span>Prix de base HT (€)</span>
          <input v-model.number="basePriceHt" type="number" min="0" step="1" >
        </label>
        <label class="field">
          <span>Incrément par tirage restant HT (€)</span>
          <input v-model.number="priceIncrementHt" type="number" min="0" step="0.01" >
        </label>
        <label class="field">
          <span>Tirages (tous formats confondus)</span>
          <input v-model.number="editionLimit" type="number" min="1" max="250" step="1" >
        </label>
        <label class="field">
          <span>TVA (%)</span>
          <input v-model.number="vatPct" type="number" min="0" max="100" step="0.1" >
        </label>
      </div>
      <p class="note">
        Les numéros sont partagés entre les formats : l'édition compte
        <strong>{{ editionLimit }} exemplaires au total</strong>, pas {{ editionLimit }} par format.
      </p>
    </section>

    <section class="panel">
      <h2 class="panel__title">Formats</h2>
      <div v-for="f in formats" :key="f.id" class="format">
        <label class="field field--name">
          <span>Nom</span>
          <input v-model="f.name" type="text" maxlength="100" >
        </label>
        <label class="field field--small">
          <span>Largeur (cm)</span>
          <input v-model.number="f.widthCm" type="number" min="1" step="1" >
        </label>
        <label class="field field--small">
          <span>Hauteur (cm)</span>
          <input v-model.number="f.heightCm" type="number" min="1" step="1" >
        </label>
        <label class="field field--small">
          <span>Facteur de prix</span>
          <input v-model.number="f.priceFactor" type="number" min="0.01" step="0.05" >
        </label>
        <button
          class="remove"
          type="button"
          :disabled="formats.length <= 1"
          :aria-label="`Supprimer le format ${f.name}`"
          @click="removeFormat(f.id)"
        >
          ✕
        </button>
      </div>
      <button class="add" type="button" :disabled="formats.length >= 10" @click="addFormat">+ Ajouter un format</button>
    </section>

    <p v-if="failed" class="state state--error">Impossible de calculer la grille.</p>
    <p v-else-if="invalidInput" class="state state--error">
      Paramètres invalides : vérifiez les prix, le nombre de tirages (1 à 250) et les facteurs de format.
    </p>

    <template v-if="grid && !invalidInput && !failed">
      <section class="verdict" :class="grid.valid ? 'verdict--ok' : 'verdict--bad'" aria-live="polite">
        <p class="verdict__head">
          {{
            grid.valid
              ? "Grille cohérente : aucun petit format ne dépasse un format supérieur."
              : "Grille incohérente : un petit format dépasse un format supérieur."
          }}
        </p>
        <ul v-if="!grid.valid" class="verdict__list">
          <li v-for="o in grid.overlaps" :key="`${o.lowerFormatId}-${o.upperFormatId}`">
            <strong>{{ o.lowerFormatName }}</strong> monte à {{ formatEuros(o.lowerMaxPriceHt) }} HT alors que
            <strong>{{ o.upperFormatName }}</strong> démarre à {{ formatEuros(o.upperMinPriceHt) }} HT. Pour corriger :
            incrément ≤ {{ formatEuros(o.maxIncrementHt) }} HT, ou facteur de
            « {{ o.upperFormatName }} » ≥ {{ formatFactor(o.minUpperPriceFactor) }}.
          </li>
        </ul>
      </section>

      <section class="panel">
        <h2 class="panel__title">Bornes par format (HT)</h2>
        <ul class="bands">
          <li v-for="b in grid.bands" :key="b.formatId" class="band">
            <span class="band__name">{{ b.formatName }} <em>×{{ formatFactor(b.priceFactor) }}</em></span>
            <span class="band__range">
              {{ formatEuros(b.minPriceHt) }} → {{ formatEuros(b.maxPriceHt) }}
            </span>
          </li>
        </ul>
        <p class="note">
          Bornes <strong>théoriques</strong> : le dernier tirage d'un format n'est pas prévisible à l'avance, puisque
          les numéros sont partagés. La règle porte donc sur ce que chaque format <em>peut</em> coûter.
        </p>
      </section>

      <section class="panel">
        <h2 class="panel__title">
          Grille complète — {{ grid.rows.length }} tirages × {{ grid.bands.length }} formats
        </h2>
        <p class="legend">
          <span class="chip chip--bad" />
          prix supérieur au tirage le moins cher d'un format plus grand
        </p>
        <div class="tablewrap">
          <table class="grid">
            <caption class="sr-only">Prix HT (TTC) de chaque tirage dans chaque format</caption>
            <thead>
              <tr>
                <th scope="col">Tirage</th>
                <th v-for="b in grid.bands" :key="b.formatId" scope="col">{{ b.formatName }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in grid.rows" :key="row.printNumber">
                <th scope="row">{{ row.printNumber }}/{{ grid.rows.length }}</th>
                <td
                  v-for="cell in row.cells"
                  :key="cell.formatId"
                  :class="{ 'cell--bad': cell.overlapping }"
                  :title="cell.overlapping ? `Dépasse le tirage le moins cher d'un format plus grand` : undefined"
                >
                  <span class="cell__ht">{{ formatEuros(cell.priceHt) }}</span>
                  <span class="cell__ttc">{{ formatEuros(cell.priceTtc) }} TTC</span>
                  <span v-if="cell.overlapping" class="sr-only">
                    — {{ formatName(cell.formatId) }} dépasse un format plus grand
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <p v-else-if="pending" class="state">Calcul…</p>
  </div>
</template>

<style scoped>
.head {
  margin-bottom: 1.2rem;
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
  margin: 0 0 1.6rem;
  color: var(--paper-dim);
  line-height: 1.7;
  font-size: 0.92rem;
}
.intro strong {
  color: var(--paper);
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
  font-weight: 600;
}
.fields {
  display: grid;
  gap: 1.1rem;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--paper-faint);
  font-weight: 600;
}
.field input {
  padding: 0.6rem 0.8rem;
  background: var(--ink);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper);
  font-family: inherit;
  font-size: 0.92rem;
  letter-spacing: normal;
  text-transform: none;
  font-weight: 400;
  width: 100%;
}
.field input:focus {
  outline: none;
  border-color: var(--brass);
}
.format {
  display: grid;
  gap: 0.9rem;
  grid-template-columns: minmax(120px, 1.4fr) repeat(3, minmax(90px, 1fr)) auto;
  align-items: end;
  padding-bottom: 1rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--ink-line);
}
.remove,
.add {
  padding: 0.55rem 0.9rem;
  background: transparent;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper-dim);
  font-family: inherit;
  font-size: 0.85rem;
  cursor: pointer;
  transition:
    color 0.2s,
    border-color 0.2s;
}
.remove:hover:not(:disabled),
.add:hover:not(:disabled) {
  border-color: var(--brass);
  color: var(--brass);
}
.remove:disabled,
.add:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.note {
  margin: 1.1rem 0 0;
  font-size: 0.8rem;
  color: var(--paper-faint);
  line-height: 1.6;
}
.note strong {
  color: var(--paper-dim);
}
.state {
  color: var(--paper-dim);
  padding: 1.5rem 0;
}
.state--error {
  color: var(--danger);
}
.verdict {
  margin-bottom: 1.4rem;
  padding: 1.1rem 1.3rem;
  border-radius: var(--radius);
  border: 1px solid var(--ink-line);
  border-left-width: 3px;
  background: var(--ink-soft);
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
  font-size: 0.95rem;
}
.verdict--ok .verdict__head {
  color: var(--brass);
}
.verdict--bad .verdict__head {
  color: var(--danger);
}
.verdict__list {
  margin: 0.7rem 0 0;
  padding-left: 1.1rem;
  line-height: 1.7;
  font-size: 0.88rem;
  color: var(--paper-dim);
}
.verdict__list strong {
  color: var(--paper);
}
.bands {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.45rem;
}
.band {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.55rem 0.8rem;
  background: var(--ink);
  border-radius: var(--radius);
  font-size: 0.9rem;
}
.band__name em {
  color: var(--paper-faint);
  font-style: normal;
  font-size: 0.8rem;
}
.band__range {
  font-variant-numeric: tabular-nums;
  color: var(--paper-dim);
}
.legend {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.9rem;
  font-size: 0.78rem;
  color: var(--paper-faint);
}
.chip {
  width: 0.9rem;
  height: 0.9rem;
  border-radius: 2px;
  border: 1px solid rgba(217, 138, 106, 0.4);
}
.chip--bad {
  background: rgba(217, 138, 106, 0.14);
}
.tablewrap {
  overflow-x: auto;
}
.grid {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}
.grid th,
.grid td {
  padding: 0.45rem 0.7rem;
  border-bottom: 1px solid var(--ink-line);
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.grid thead th {
  color: var(--paper-faint);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.grid thead th,
.grid tbody th {
  text-align: left;
  font-weight: 600;
  white-space: nowrap;
}
.grid tbody th {
  color: var(--paper-dim);
}
.cell--bad {
  background: rgba(217, 138, 106, 0.14);
  color: var(--danger);
  font-weight: 600;
}
.cell__ht {
  display: block;
}
.cell__ttc {
  display: block;
  font-size: 0.72rem;
  color: var(--paper-faint);
}
.cell--bad .cell__ttc {
  color: rgba(217, 138, 106, 0.75);
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

@media (max-width: 720px) {
  .format {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
