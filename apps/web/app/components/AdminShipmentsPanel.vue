<script setup lang="ts">
import { SHIPPING_CARRIERS } from "@armurier/shared"
import type { AdminOrderDetail, AdminShipment } from "~/types/admin"
import { formatDateTime } from "~/utils/format"
import { parcelItemLabel } from "~/utils/order"
import { shipmentStatus } from "~/utils/status"

// Story 11.9 — multi-parcel shipping on the admin order screen. Packing starts
// from the server's suggestion and stays editable; nothing is created on its own.

const props = defineProps<{ order: AdminOrderDetail }>()
const emit = defineEmits<{ changed: [] }>()
const api = useApi()

// Re-bound locally so the template sees it.
const carriers = SHIPPING_CARRIERS

const busy = ref(false)
const error = ref<string | null>(null)

const GATE_MESSAGES = {
  unpaid:
    "La commande n'est pas encore payée : les colis peuvent être préparés, mais aucun ne peut partir avant l'encaissement.",
  legal:
    "Les documents légaux ne sont pas validés : les colis peuvent être préparés, mais aucune arme réglementée ne peut partir avant leur validation.",
  // Story 11.9b — le retrait n'est pas proposé aujourd'hui. Si une commande en
  // porte quand même la mention, il vaut mieux le dire que de laisser le
  // panneau proposer des colis que personne ne postera jamais.
  pickup: "Cette commande est à retirer en armurerie : elle n'est pas expédiée, il n'y a aucun colis à préparer.",
} as const

const gateMessage = computed(() => {
  const gate = props.order.shipGate
  return gate.ok ? null : GATE_MESSAGES[gate.reason]
})

const isPickup = computed(() => {
  const gate = props.order.shipGate
  return !gate.ok && gate.reason === "pickup"
})

function messageFrom(err: unknown): string {
  const body = (err as { data?: { message?: string; issues?: Array<{ path: string; message: string }> } }).data
  if (body?.issues?.length) return body.issues.map((i) => `${i.path} : ${i.message}`).join(" · ")
  return body?.message ?? "L'opération a échoué."
}

async function run(action: () => Promise<unknown>) {
  busy.value = true
  error.value = null
  try {
    await action()
    emit("changed")
  } catch (err) {
    error.value = messageFrom(err)
  } finally {
    busy.value = false
  }
}

// --- Packing ---------------------------------------------------------------

interface DraftItem {
  variantId?: string
  printId?: string
  name: string
  qty: number
  max: number
  part: number
  parts: number
}

interface DraftParcel {
  carrier: string
  trackingNumber: string
  trackingUrl: string
  notes: string
  items: DraftItem[]
}

const drafts = ref<DraftParcel[] | null>(null)

function openPacking() {
  error.value = null
  drafts.value = props.order.suggestedParcels.map((p) => ({
    carrier: "colissimo",
    trackingNumber: "",
    trackingUrl: "",
    notes: "",
    items: p.items.map((i) => ({ ...i, max: i.qty })),
  }))
}

function draftBody(d: DraftParcel) {
  const items = d.items
    .filter((i) => Number(i.qty) > 0)
    .map((i) => ({
      ...(i.variantId ? { variantId: i.variantId } : { printId: i.printId }),
      qty: Number(i.qty),
      part: i.part,
      parts: i.parts,
    }))
  return {
    orderId: props.order.id,
    carrier: d.carrier,
    ...(d.trackingNumber.trim() ? { trackingNumber: d.trackingNumber.trim() } : {}),
    ...(d.carrier === "other" && d.trackingUrl.trim() ? { trackingUrl: d.trackingUrl.trim() } : {}),
    ...(d.notes.trim() ? { notes: d.notes.trim() } : {}),
    items,
  }
}

/**
 * One call per parcel. A parcel created before a later one fails is kept and
 * taken off the form, so fixing the failing one never duplicates the others.
 */
async function submitPacking() {
  if (!drafts.value) return
  busy.value = true
  error.value = null
  let created = 0
  try {
    while (drafts.value.length > 0) {
      const draft = drafts.value[0] as DraftParcel
      const body = draftBody(draft)
      if (body.items.length > 0) {
        await api("/admin/shipments", { method: "POST", body })
        created++
      }
      drafts.value.shift()
    }
    drafts.value = null
  } catch (err) {
    error.value = messageFrom(err)
  } finally {
    busy.value = false
    if (created > 0) emit("changed")
  }
}

// --- Existing parcels ------------------------------------------------------

const setStatus = (s: AdminShipment, status: string) =>
  run(() => api(`/admin/shipments/${s.id}`, { method: "PATCH", body: { status } }))

// Suivi automatique (11.9b). L'API refuse proprement quand aucun transporteur
// n'est interrogeable : on relaie sa phrase plutôt que de masquer le bouton,
// pour que l'admin sache POURQUOI il doit cocher « livré » à la main.
const refreshTracking = (s: AdminShipment) =>
  run(() => api(`/admin/shipments/${s.id}/refresh-tracking`, { method: "POST" }))

function remove(s: AdminShipment) {
  if (!window.confirm("Supprimer ce colis ? Son contenu redeviendra à expédier.")) return
  return run(() => api(`/admin/shipments/${s.id}`, { method: "DELETE" }))
}

const editing = ref<string | null>(null)
const edit = reactive({ carrier: "", trackingNumber: "", trackingUrl: "", notes: "" })

function startEdit(s: AdminShipment) {
  error.value = null
  editing.value = s.id
  Object.assign(edit, {
    carrier: s.carrier,
    trackingNumber: s.trackingNumber ?? "",
    trackingUrl: s.carrier === "other" ? (s.trackingUrl ?? "") : "",
    notes: s.notes ?? "",
  })
}

async function saveEdit(s: AdminShipment) {
  await run(() =>
    api(`/admin/shipments/${s.id}`, {
      method: "PATCH",
      body: {
        carrier: edit.carrier,
        // `null` clears a field; for a listed carrier the link is built by the API.
        trackingNumber: edit.trackingNumber.trim() || null,
        trackingUrl: edit.carrier === "other" ? edit.trackingUrl.trim() || null : null,
        notes: edit.notes.trim() || null,
      },
    }),
  )
  if (!error.value) editing.value = null
}
</script>

<template>
  <section class="ship" aria-labelledby="ship-title">
    <h2 id="ship-title" class="ship__title">Expédition</h2>

    <p v-if="gateMessage" class="gate" role="status">{{ gateMessage }}</p>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <ol v-if="order.shipments.length" class="parcels">
      <li v-for="(s, i) in order.shipments" :key="s.id" class="parcel">
        <div class="parcel__head">
          <p class="parcel__name">Colis {{ i + 1 }}/{{ order.shipments.length }}</p>
          <AdminStatusTag v-bind="shipmentStatus(s.status)" />
        </div>

        <p class="parcel__meta">
          {{ s.carrierLabel }}
          <template v-if="s.trackingUrl">
            ·
            <a :href="s.trackingUrl" target="_blank" rel="noopener noreferrer" class="link">
              {{ s.trackingNumber || "Lien de suivi" }}
            </a>
          </template>
          <template v-else-if="s.trackingNumber"> · {{ s.trackingNumber }}</template>
          <template v-else> · <em>sans numéro de suivi</em></template>
        </p>
        <p v-if="s.shippedAt || s.deliveredAt" class="parcel__meta">
          <template v-if="s.shippedAt">Parti le {{ formatDateTime(s.shippedAt) }}</template>
          <template v-if="s.deliveredAt"> · livré le {{ formatDateTime(s.deliveredAt) }}</template>
          <template v-if="s.notifiedAt"> · client prévenu</template>
        </p>
        <p v-if="s.trackingLabel" class="parcel__tracking">
          « {{ s.trackingLabel }} »
          <template v-if="s.trackingCheckedAt">
            <span class="parcel__tracking-at">— transporteur interrogé le {{ formatDateTime(s.trackingCheckedAt) }}</span>
          </template>
        </p>

        <ul class="parcel__items">
          <li v-for="it in s.items" :key="it.id">{{ parcelItemLabel(it) }}</li>
        </ul>
        <p v-if="s.notes" class="parcel__notes">Note interne : {{ s.notes }}</p>

        <form v-if="editing === s.id" class="edit" @submit.prevent="saveEdit(s)">
          <label class="field">
            <span>Transporteur</span>
            <select v-model="edit.carrier" class="ctl">
              <option v-for="c in carriers" :key="c.code" :value="c.code">{{ c.label }}</option>
            </select>
          </label>
          <label class="field">
            <span>N° de suivi</span>
            <input v-model="edit.trackingNumber" class="ctl" maxlength="100" />
          </label>
          <label v-if="edit.carrier === 'other'" class="field field--wide">
            <span>Lien de suivi (https)</span>
            <input v-model="edit.trackingUrl" type="url" class="ctl" maxlength="512" />
          </label>
          <label class="field field--wide">
            <span>Note interne</span>
            <input v-model="edit.notes" class="ctl" maxlength="1000" />
          </label>
          <div class="actions">
            <button type="submit" class="btn btn-primary" :disabled="busy">Enregistrer</button>
            <button type="button" class="btn btn-ghost" :disabled="busy" @click="editing = null">Annuler</button>
          </div>
        </form>

        <div v-else class="actions">
          <template v-if="s.status === 'preparing'">
            <button
              type="button"
              class="btn btn-primary ship-btn"
              :disabled="busy || !order.shipGate.ok"
              @click="setStatus(s, 'shipped')"
            >
              Marquer expédié
            </button>
            <button type="button" class="btn btn-ghost delete-btn" :disabled="busy" @click="remove(s)">
              Supprimer
            </button>
          </template>
          <template v-else-if="s.status === 'shipped'">
            <button type="button" class="btn btn-ghost track-btn" :disabled="busy" @click="refreshTracking(s)">
              Rafraîchir le suivi
            </button>
            <button type="button" class="btn btn-primary deliver-btn" :disabled="busy" @click="setStatus(s, 'delivered')">
              Marquer livré
            </button>
            <button type="button" class="btn btn-ghost" :disabled="busy" @click="setStatus(s, 'preparing')">
              Repasser en préparation
            </button>
          </template>
          <button v-else type="button" class="btn btn-ghost" :disabled="busy" @click="setStatus(s, 'shipped')">
            Annuler la livraison
          </button>
          <button type="button" class="btn btn-ghost" :disabled="busy" @click="startEdit(s)">Modifier le suivi</button>
        </div>
      </li>
    </ol>

    <p v-else-if="!isPickup && !order.suggestedParcels.length" class="empty">Aucun article à expédier.</p>

    <!-- Packing what is left, from the suggestion -->
    <template v-if="order.suggestedParcels.length">
      <button v-if="!drafts" type="button" class="btn btn-ghost pack-open" :disabled="busy" @click="openPacking">
        {{ order.shipments.length ? "Préparer le reste" : "Préparer l'expédition" }}
        ({{ order.suggestedParcels.length }} colis proposé{{ order.suggestedParcels.length > 1 ? "s" : "" }})
      </button>

      <form v-else class="pack" @submit.prevent="submitPacking">
        <p class="pack__lede">
          Découpage proposé d'après le nombre de colis de chaque article. Mettez une quantité à 0 pour retirer un
          article d'un colis : il sera proposé à nouveau.
        </p>
        <fieldset v-for="(d, i) in drafts" :key="i" class="draft">
          <legend class="draft__title">Nouveau colis {{ order.shipments.length + i + 1 }}</legend>
          <div class="fields">
            <label class="field">
              <span>Transporteur</span>
              <select v-model="d.carrier" class="ctl">
                <option v-for="c in carriers" :key="c.code" :value="c.code">{{ c.label }}</option>
              </select>
            </label>
            <label class="field">
              <span>N° de suivi</span>
              <input v-model="d.trackingNumber" class="ctl" maxlength="100" />
            </label>
            <label v-if="d.carrier === 'other'" class="field field--wide">
              <span>Lien de suivi (https)</span>
              <input v-model="d.trackingUrl" type="url" class="ctl" maxlength="512" />
            </label>
            <label class="field field--wide">
              <span>Note interne</span>
              <input v-model="d.notes" class="ctl" maxlength="1000" />
            </label>
          </div>
          <div v-for="(it, j) in d.items" :key="j" class="draft__line">
            <span class="draft__name">
              {{ it.name }}<template v-if="it.parts > 1"> — partie {{ it.part }}/{{ it.parts }}</template>
            </span>
            <label class="draft__qty-label">
              <span class="sr-only">Quantité de {{ it.name }}</span>
              <input v-model.number="it.qty" type="number" min="0" :max="it.max" class="ctl draft__qty" />
            </label>
          </div>
        </fieldset>
        <div class="actions">
          <button type="button" class="btn btn-primary pack-submit" :disabled="busy" @click="submitPacking">
            {{ busy ? "Création…" : "Créer les colis" }}
          </button>
          <button type="button" class="btn btn-ghost" :disabled="busy" @click="drafts = null">Annuler</button>
        </div>
      </form>
    </template>
  </section>
</template>

<style scoped>
.ship {
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  padding: 1.3rem 1.4rem;
}
.ship__title {
  font-size: 1.05rem;
  margin-bottom: 1rem;
}
.gate {
  margin: 0 0 1rem;
  padding: 0.7rem 0.9rem;
  font-size: 0.85rem;
  border-radius: var(--radius);
  color: var(--paper);
  background: color-mix(in srgb, var(--brass) 12%, transparent);
}
.alert {
  margin: 0 0 1rem;
  color: var(--danger);
  font-size: 0.85rem;
}
.parcels {
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
  display: grid;
  gap: 0.8rem;
}
.parcel,
.draft {
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  background: var(--ink);
  padding: 0.9rem 1rem;
  min-width: 0;
}
.parcel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
}
.parcel__name,
.draft__title {
  margin: 0;
  font-weight: 600;
}
.parcel__tracking {
  margin: 0.15rem 0 0;
  font-size: 0.85rem;
  font-style: italic;
  color: var(--p-text-muted-color);
}

.parcel__tracking-at {
  font-style: normal;
  opacity: 0.75;
}

.parcel__meta {
  margin: 0.3rem 0 0;
  font-size: 0.8rem;
  color: var(--paper-dim);
  overflow-wrap: anywhere;
}
.parcel__items {
  margin: 0.6rem 0 0;
  padding-left: 1.1rem;
  font-size: 0.88rem;
}
.parcel__notes {
  margin: 0.5rem 0 0;
  font-size: 0.8rem;
  color: var(--paper-faint);
}
.link {
  color: var(--brass);
  text-decoration: underline;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.8rem;
}
.empty {
  color: var(--paper-dim);
  font-size: 0.9rem;
}
.pack {
  display: grid;
  gap: 0.8rem;
}
.pack__lede {
  margin: 0;
  font-size: 0.85rem;
  color: var(--paper-dim);
}
.fields,
.edit {
  display: grid;
  gap: 0.7rem;
  grid-template-columns: 1fr;
  margin-top: 0.7rem;
}
.field span {
  display: block;
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--paper-faint);
  margin-bottom: 0.35rem;
}
.ctl {
  width: 100%;
  padding: 0.55rem 0.7rem;
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper);
  font-family: inherit;
  font-size: 0.88rem;
}
.ctl:focus {
  outline: none;
  border-color: var(--brass);
}
.draft__line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  padding: 0.5rem 0;
  border-top: 1px solid var(--ink-line);
  margin-top: 0.6rem;
}
.draft__name {
  font-size: 0.88rem;
}
.draft__qty {
  width: 5rem;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
@media (min-width: 700px) {
  .fields,
  .edit {
    grid-template-columns: 1fr 1fr;
  }
  .field--wide,
  .edit .actions {
    grid-column: 1 / -1;
  }
}
</style>
