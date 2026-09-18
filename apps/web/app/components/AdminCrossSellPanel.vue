<script setup lang="ts">
import { MAX_CROSS_SELLS_PER_PRODUCT } from "@armurier/shared"
import type { AdminCrossSellOption, AdminCrossSellState } from "~/types/admin-catalogue"
import { formatEuros } from "~/utils/format"

/**
 * Suggestions « fréquemment achetés ensemble » d'une arme (story 11.8).
 *
 * ⚠️ Les associations sont saisies à la main : c'est la seule façon de tenir la
 * promesse « ne jamais suggérer un accessoire interdit », puisque la restriction
 * est une note en texte libre qu'aucune règle ne sait lire. L'écran affiche donc
 * cette note bien en vue, et le serveur ne refuse que le mécanique.
 */
const props = defineProps<{ productId: string | null }>()
const api = useApi()

const state = ref<AdminCrossSellState | null>(null)
const options = ref<AdminCrossSellOption[]>([])
const chosen = ref<string[]>([])
const busy = ref(false)
const error = ref<string | null>(null)
const saved = ref(false)

const max = MAX_CROSS_SELLS_PER_PRODUCT
const atMax = computed(() => chosen.value.length >= max)
const optionById = computed(() => new Map(options.value.map((o) => [o.id, o])))
const available = computed(() => options.value.filter((o) => !chosen.value.includes(o.id)))

function messageFrom(err: unknown): string {
  const body = (err as { data?: { message?: string; issues?: Array<{ path: string; message: string }> } }).data
  if (body?.issues?.length) return body.issues.map((i) => `${i.path} : ${i.message}`).join(" · ")
  return body?.message ?? "L'opération a échoué."
}

async function load() {
  if (!props.productId) return
  try {
    const [current, opts] = await Promise.all([
      api<{ data: AdminCrossSellState }>(`/admin/products/${props.productId}/cross-sells`),
      api<{ data: AdminCrossSellOption[] }>(`/admin/products/${props.productId}/cross-sell-options`),
    ])
    state.value = current.data
    options.value = opts.data
    chosen.value = current.data.items.map((i) => i.id)
  } catch (err) {
    error.value = messageFrom(err)
  }
}
onMounted(load)

// La catégorie légale de l'arme change ce qu'elle a le droit de proposer : après
// un enregistrement, les options sont rechargées plutôt que devinées.
watch(() => props.productId, load)

function add(id: string) {
  if (!id || atMax.value || chosen.value.includes(id)) return
  chosen.value.push(id)
  saved.value = false
}
function remove(index: number) {
  chosen.value.splice(index, 1)
  saved.value = false
}
function move(index: number, delta: number) {
  const target = index + delta
  const item = chosen.value[index]
  const other = chosen.value[target]
  if (item === undefined || other === undefined) return
  chosen.value[index] = other
  chosen.value[target] = item
  saved.value = false
}

async function save() {
  if (!props.productId) return
  busy.value = true
  error.value = null
  saved.value = false
  try {
    await api(`/admin/products/${props.productId}/cross-sells`, {
      method: "PUT",
      body: { accessoryIds: chosen.value },
    })
    saved.value = true
    await load()
  } catch (err) {
    error.value = messageFrom(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="productId" class="xs">
    <p v-if="state && !state.eligible" class="xs__note xs__note--off">{{ state.reason }}</p>

    <template v-else>
      <!-- Le bloc est éteint par défaut : préparer les associations à l'avance
           est légitime, mais l'admin doit savoir que rien ne s'affiche encore. -->
      <p v-if="state && !state.enabled" class="xs__note xs__note--off">
        Le bloc est <strong>désactivé</strong> sur le site : ces suggestions sont préparées, elles ne s'afficheront
        qu'une fois le bloc activé.
      </p>

      <p v-if="state?.hasAccessoryRestrictions" class="xs__note xs__note--warn">
        ⚠️ Restrictions d'accessoires sur cette arme :
        {{ state.accessoryRestrictionNotes || "aucune précision saisie sur la fiche." }}
        <span class="xs__notehelp">
          Aucune règle ne peut les vérifier à votre place — c'est à vous de n'ajouter ici que des accessoires permis.
        </span>
      </p>

      <ol v-if="chosen.length > 0" class="xs__list">
        <li v-for="(accessoryId, index) in chosen" :key="accessoryId" class="xs__row">
          <span class="xs__pos">{{ index + 1 }}</span>
          <span class="xs__name">
            {{ optionById.get(accessoryId)?.name ?? state?.items.find((i) => i.id === accessoryId)?.name ?? accessoryId }}
          </span>
          <span class="xs__price">
            {{ formatEuros(optionById.get(accessoryId)?.priceHt ?? state?.items.find((i) => i.id === accessoryId)?.priceHt ?? 0) }}
            HT
          </span>
          <span class="xs__actions">
            <button type="button" class="btn-mini" :disabled="index === 0" aria-label="Monter" @click="move(index, -1)">
              ↑
            </button>
            <button
              type="button"
              class="btn-mini"
              :disabled="index === chosen.length - 1"
              aria-label="Descendre"
              @click="move(index, 1)"
            >
              ↓
            </button>
            <button type="button" class="btn-mini btn-mini--danger" aria-label="Retirer" @click="remove(index)">
              ✕
            </button>
          </span>
        </li>
      </ol>
      <p v-else class="xs__empty">Aucune suggestion. La fiche n'affichera pas le bloc.</p>

      <div class="xs__add">
        <label class="field">
          <span class="field__label">Ajouter un accessoire</span>
          <select class="ctl" :disabled="atMax" @change="add(($event.target as HTMLSelectElement).value)">
            <option value="">— choisir —</option>
            <option v-for="option in available" :key="option.id" :value="option.id">
              {{ option.name }} — {{ option.category.name }} ({{ formatEuros(option.priceHt) }} HT)
            </option>
          </select>
          <span class="field__help">
            {{ chosen.length }} / {{ max }} suggestions.
            Seuls les accessoires compatibles avec la catégorie légale de cette arme sont proposés.
          </span>
        </label>
        <button type="button" class="btn btn-primary" :disabled="busy" @click="save">
          {{ busy ? "Enregistrement…" : "Enregistrer les suggestions" }}
        </button>
      </div>

      <p v-if="saved" class="xs__ok" role="status">Suggestions enregistrées.</p>
      <p v-if="error" class="xs__err" role="alert">{{ error }}</p>
    </template>
  </div>
  <p v-else class="xs__empty">Enregistrez le produit pour lui associer des accessoires.</p>
</template>

<style scoped>
.xs {
  display: grid;
  gap: 1rem;
}
.xs__note {
  margin: 0;
  padding: 0.7rem 0.9rem;
  border-radius: var(--radius);
  border-left: 3px solid var(--ink-line);
  background: var(--ink);
  color: var(--paper-dim);
  font-size: 0.85rem;
  line-height: 1.5;
}
.xs__note--off {
  border-left-color: var(--brass);
}
.xs__note--warn {
  border-left-color: var(--danger);
  color: var(--paper);
}
.xs__notehelp {
  display: block;
  margin-top: 0.3rem;
  color: var(--paper-faint);
}
.xs__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.4rem;
}
.xs__row {
  display: grid;
  grid-template-columns: 1.6rem 1fr auto auto;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0.7rem;
  background: var(--ink);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
}
.xs__pos {
  color: var(--paper-faint);
  font-variant-numeric: tabular-nums;
}
.xs__price {
  color: var(--paper-dim);
  font-variant-numeric: tabular-nums;
  font-size: 0.85rem;
}
.xs__actions {
  display: flex;
  gap: 0.25rem;
}
.btn-mini {
  background: var(--ink-soft);
  color: var(--paper-dim);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  padding: 0.15rem 0.45rem;
  cursor: pointer;
}
.btn-mini:disabled {
  opacity: 0.35;
  cursor: default;
}
.btn-mini--danger:hover {
  color: var(--danger);
  border-color: var(--danger);
}
.xs__empty {
  margin: 0;
  color: var(--paper-faint);
  font-size: 0.85rem;
}
.xs__add {
  display: grid;
  gap: 0.7rem;
  align-items: end;
}
@media (min-width: 720px) {
  .xs__add {
    grid-template-columns: 1fr auto;
  }
}
.xs__ok {
  margin: 0;
  color: var(--brass);
  font-size: 0.85rem;
}
.xs__err {
  margin: 0;
  color: var(--danger);
  font-size: 0.85rem;
}
</style>
