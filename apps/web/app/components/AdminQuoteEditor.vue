<script setup lang="ts">
import type { AdminQuoteChanges, AdminQuoteRequestDetail } from "~/types/quote"
import { formatDate, formatDateTime, formatEuros } from "~/utils/format"
import { henrriBlockReason } from "~/utils/henrri"
import { legalCategoryLabel } from "~/utils/product"

// Story 12.8d — SCS prices a quote: each line by discount on the public price
// or by hand, the delivery (the grid's, editable), the validity, and its
// verdict on the organisation's documents; then sends it through Henrri.
const props = defineProps<{ quote: AdminQuoteRequestDetail }>()
const emit = defineEmits<{ updated: [quote: AdminQuoteRequestDetail] }>()

const api = useApi()

interface LineDraft {
  unitPriceHt: number | null
  discountPct: number | null
  /** Which field SCS typed last: the other one follows from it on the server. */
  changed: "unitPriceHt" | "discountPct" | null
}

const lines = ref<Record<string, LineDraft>>({})
const shippingTtc = ref<number | null>(null)
const validUntil = ref("")
const documentsSufficient = ref(false)

function reset(quote: AdminQuoteRequestDetail) {
  lines.value = Object.fromEntries(
    quote.items.map((item) => [
      item.id,
      { unitPriceHt: item.quotedPriceHt, discountPct: item.lineDiscountPct, changed: null },
    ]),
  )
  shippingTtc.value = quote.shippingTtc
  validUntil.value = quote.validUntil ?? ""
  documentsSufficient.value = quote.documentsSufficient !== null
}
watch(() => props.quote, reset, { immediate: true })

const editable = computed(() => props.quote.status === "in_review" && !props.quote.sending)
const blockedReason = computed(() =>
  props.quote.henrri?.status === "blocked" ? henrriBlockReason(props.quote.henrri.lastError) : null,
)
const busy = ref(false)
const error = ref("")

function changes(): AdminQuoteChanges {
  const patch: AdminQuoteChanges = {}
  const items: NonNullable<AdminQuoteChanges["items"]> = []
  for (const [id, line] of Object.entries(lines.value)) {
    if (line.changed === "unitPriceHt" && line.unitPriceHt !== null) items.push({ id, unitPriceHt: line.unitPriceHt })
    if (line.changed === "discountPct" && line.discountPct !== null) items.push({ id, discountPct: line.discountPct })
  }
  if (items.length > 0) patch.items = items
  if (shippingTtc.value !== null && shippingTtc.value !== props.quote.shippingTtc) patch.shippingTtc = shippingTtc.value
  if (validUntil.value && validUntil.value !== props.quote.validUntil) patch.validUntil = validUntil.value
  if (props.quote.requiresDocuments && documentsSufficient.value !== (props.quote.documentsSufficient !== null)) {
    patch.documentsSufficient = documentsSufficient.value
  }
  return patch
}

const dirty = computed(() => Object.keys(changes()).length > 0)

function messageOf(err: unknown): string {
  return (err as { data?: { message?: string } })?.data?.message ?? "L'opération a échoué."
}

async function run(request: () => Promise<{ data: AdminQuoteRequestDetail }>) {
  busy.value = true
  error.value = ""
  try {
    emit("updated", (await request()).data)
  } catch (err) {
    error.value = messageOf(err)
  } finally {
    busy.value = false
  }
}

function save() {
  const body = changes()
  if (Object.keys(body).length === 0) return
  return run(() =>
    api<{ data: AdminQuoteRequestDetail }>(`/admin/quote-requests/${props.quote.id}`, { method: "PATCH", body }),
  )
}

function send() {
  return run(() =>
    api<{ data: AdminQuoteRequestDetail }>(`/admin/quote-requests/${props.quote.id}/send`, { method: "POST" }),
  )
}

const canSend = computed(
  () =>
    editable.value && !dirty.value && props.quote.totals !== null && props.quote.organisation.billingAddressComplete,
)
</script>

<template>
  <section class="quote">
    <h3 class="quote__h">Devis</h3>

    <p v-if="quote.sending" class="notice" role="status">
      Émission en cours chez Henrri : le devis part au client dès qu'il est émis, d'ici quelques minutes.
    </p>
    <p v-if="blockedReason" class="notice notice--error" role="alert">
      Henrri n'a pas émis le devis. {{ blockedReason }} Corrigez-le puis renvoyez-le.
    </p>

    <form v-if="quote.status === 'in_review'" class="form" @submit.prevent="save">
      <ul class="lines" role="list">
        <li v-for="item in quote.items" :key="item.id" class="line">
          <div class="line__main">
            <span class="strong">{{ item.productName }}</span>
            <span class="sub">
              <template v-if="item.variantLabel">{{ item.variantLabel }} · </template>{{ item.variantSku ?? item.productSku }} ·
              {{ legalCategoryLabel(item.legalCategory) }} · × {{ item.qty }}
            </span>
            <span class="sub">Prix public : {{ formatEuros(item.publicPriceHt) }} HT</span>
          </div>
          <div v-if="lines[item.id]" class="line__inputs">
            <label class="field">
              <span>Remise %</span>
              <input
                :name="`discount-${item.id}`"
                v-model.number="lines[item.id]!.discountPct"
                type="number"
                min="0"
                max="100"
                step="0.01"
                :disabled="!editable"
                @input="lines[item.id]!.changed = 'discountPct'"
              />
            </label>
            <label class="field">
              <span>Prix unitaire HT</span>
              <input
                :name="`price-${item.id}`"
                v-model.number="lines[item.id]!.unitPriceHt"
                type="number"
                min="0"
                step="0.01"
                :disabled="!editable"
                @input="lines[item.id]!.changed = 'unitPriceHt'"
              />
            </label>
          </div>
        </li>
      </ul>

      <div class="row">
        <label class="field">
          <span>Port TTC</span>
          <input name="shipping" v-model.number="shippingTtc" type="number" min="0" step="0.01" :disabled="!editable" />
        </label>
        <label class="field">
          <span>Valable jusqu'au</span>
          <input name="valid-until" v-model="validUntil" type="date" :disabled="!editable" />
        </label>
      </div>

      <label v-if="quote.requiresDocuments" class="check">
        <input name="documents-sufficient" v-model="documentsSufficient" type="checkbox" :disabled="!editable" />
        <span>
          Justificatifs de l'organisation suffisants pour les articles de catégorie A, B ou C
          <span class="sub">Sans cette case, le client ne pourra pas accepter le devis.</span>
        </span>
      </label>

      <p v-if="editable" class="actions">
        <button type="submit" class="btn btn-ghost save" :disabled="busy || !dirty">Enregistrer</button>
      </p>
    </form>

    <dl v-if="quote.totals" class="totals">
      <div><dt>Total HT</dt><dd>{{ formatEuros(quote.totals.totalHt) }}</dd></div>
      <div><dt>TVA</dt><dd>{{ formatEuros(quote.totals.vatAmount) }}</dd></div>
      <div class="totals__ttc"><dt>Total TTC</dt><dd>{{ formatEuros(quote.totals.totalTtc) }}</dd></div>
    </dl>

    <template v-if="quote.status !== 'in_review'">
      <dl class="meta">
        <div v-if="quote.henrri?.number"><dt>Devis Henrri</dt><dd>{{ quote.henrri.number }}</dd></div>
        <div v-if="quote.sentAt"><dt>Envoyé le</dt><dd>{{ formatDateTime(quote.sentAt) }}</dd></div>
        <div v-if="quote.validUntil"><dt>Valable jusqu'au</dt><dd>{{ formatDate(quote.validUntil) }}</dd></div>
        <div v-if="quote.requiresDocuments">
          <dt>Justificatifs</dt>
          <dd>{{ quote.documentsSufficient ? "Jugés suffisants" : "Pas encore jugés suffisants" }}</dd>
        </div>
      </dl>
    </template>

    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>

    <template v-if="editable">
      <p v-if="!quote.organisation.billingAddressComplete" class="hint">
        Renseignez d'abord l'adresse de facturation de l'organisation dans
        <NuxtLink to="/admin/organisations">Comptes pro</NuxtLink> : Henrri en a besoin pour émettre le devis.
      </p>
      <p v-else-if="dirty" class="hint">Enregistrez vos modifications avant d'envoyer le devis.</p>
      <p class="actions">
        <button type="button" class="btn btn-primary send" :disabled="busy || !canSend" @click="send">
          Envoyer le devis
        </button>
      </p>
    </template>
  </section>
</template>

<style scoped>
.quote {
  margin: 1.4rem 0;
}
.quote__h {
  font-size: var(--fs-md);
  margin: 0 0 0.8rem;
}
.lines {
  list-style: none;
  margin: 0;
  padding: 0;
}
.line {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.8rem;
  padding: 0.7rem 0;
  border-bottom: 1px solid var(--ink-line);
}
.line__inputs,
.row {
  display: flex;
  gap: 0.8rem;
  flex-wrap: wrap;
}
.row {
  margin-top: 1rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: var(--fs-xs);
  color: var(--paper-faint);
}
.field input {
  width: 9rem;
  padding: 0.5rem 0.6rem;
  background: var(--ink);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper);
  font-family: inherit;
  font-size: var(--fs-base);
  color-scheme: dark;
}
.field input:focus {
  outline: none;
  border-color: var(--brass);
}
.field input:disabled {
  color: var(--paper-faint);
}
.check {
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
  margin-top: 1rem;
  font-size: var(--fs-sm);
}
.strong {
  display: block;
  font-weight: var(--fw-semibold);
}
.sub {
  display: block;
  color: var(--paper-faint);
  font-size: var(--fs-xs);
  margin-top: 0.15rem;
}
.totals,
.meta {
  margin: 1.2rem 0 0;
}
.totals div,
.meta div {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.35rem 0;
  border-bottom: 1px solid var(--ink-line);
}
.totals dt,
.meta dt {
  color: var(--paper-faint);
  font-size: var(--fs-sm);
}
.totals dd,
.meta dd {
  margin: 0;
  text-align: right;
}
.totals__ttc dd {
  font-weight: var(--fw-semibold);
  color: var(--brass);
}
.notice {
  font-size: var(--fs-sm);
  color: var(--paper-dim);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  padding: 0.7rem 0.9rem;
  margin: 0 0 1rem;
}
.notice--error {
  color: var(--danger);
  border-color: var(--danger);
}
.hint {
  color: var(--paper-faint);
  font-size: var(--fs-sm);
  margin-top: 0.8rem;
}
.actions {
  margin-top: 1rem;
}
</style>
