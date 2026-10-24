<script setup lang="ts">
import type { AdminOrderDetail } from "~/types/admin"
import { formatDateTime, formatEuros } from "~/utils/format"
import { henrriBlockReason, henrriDocumentLabel, henrriDocumentStatus } from "~/utils/henrri"
import {
  REFUND_KIND_OPTIONS,
  type RefundForm,
  type RefundKind,
  refundFailure,
  refundRequestBody,
  returnableQuantities,
  shippingRefunded,
} from "~/utils/refund"
import { legalStatus, paymentStatus, refundStatus, shippingStatus } from "~/utils/status"

definePageMeta({ layout: "admin", middleware: "admin" })

const route = useRoute()
const api = useApi()
const id = route.params.id as string

const { data, pending, error, refresh } = await useAsyncData(
  `admin-order-${id}`,
  () => api<{ data: AdminOrderDetail }>(`/admin/orders/${id}`),
  { server: false },
)
const order = computed(() => data.value?.data)

useHead({ title: () => `Commande ${id.slice(0, 8)} — Administration SCS` })

// Story 12.7b — the order's history sits in its own tab, next to the detail.
const TABS = [
  { id: "detail", label: "Détail" },
  { id: "history", label: "Historique" },
]
const activeTab = ref("detail")

const PAID = ["received", "reconciled", "partially_refunded"]

// What is still refundable on each channel: amount paid minus refunds already
// recorded on that channel (the API enforces the same cap; this guides the form).
const refundable = computed(() => {
  const o = order.value
  if (!o) return { carte: 0, virement: 0 }
  const sumRefunds = (channel: string) =>
    o.payment.refunds
      .filter((r) => r.channel === channel && r.status !== "failed" && r.status !== "cancelled")
      .reduce((acc, r) => acc + Number(r.amountTtc), 0)
  const carte =
    o.payment.carte && PAID.includes(o.payment.carte.paymentStatus)
      ? Number(o.payment.carte.amountTtc) - sumRefunds("carte")
      : 0
  const v = o.payment.virement
  const virement =
    v && PAID.includes(v.paymentStatus)
      ? Number(v.amountReceivedTtc ?? v.amountExpectedTtc) - sumRefunds("virement")
      : 0
  return { carte: Math.max(0, Math.round(carte * 100) / 100), virement: Math.max(0, Math.round(virement * 100) / 100) }
})
const canRefund = computed(() => refundable.value.carte > 0 || refundable.value.virement > 0)

// Refund modal (story 12.6): a goods return picks the articles that came back
// (the API computes the amount), a goodwill gesture or an overpayment is an amount.
const showRefund = ref(false)
const refundKind = ref<RefundKind>("goods_return")
const refundChannel = ref<"carte" | "virement">("carte")
const refundAmount = ref<number | null>(null)
const refundQuantities = ref<number[]>([])
const refundShipping = ref(false)
const refundReason = ref("")
const refundBusy = ref(false)
const refundError = ref("")
const refundSuggestions = ref<number[]>([])
const refundPreview = ref<number | null>(null)

const returnable = computed(() =>
  order.value ? returnableQuantities(order.value.items, order.value.payment.refunds) : [],
)
const deliveryRefunded = computed(() => (order.value ? shippingRefunded(order.value.payment.refunds) : true))

function refundForm(): RefundForm {
  return {
    kind: refundKind.value,
    channel: refundChannel.value,
    quantities: refundQuantities.value,
    includesShipping: refundShipping.value,
    amount: refundAmount.value,
    reason: refundReason.value,
  }
}

// Story 12.9g — the name of the refund being prepared. A resend after no
// answer (network cut, timeout) keeps it, so the API answers with the refund
// already made rather than a second one; any answer starts a new one.
let refundKey = crypto.randomUUID()

function openRefund() {
  refundKey = crypto.randomUUID()
  refundError.value = ""
  refundSuggestions.value = []
  refundPreview.value = null
  refundKind.value = "goods_return"
  refundChannel.value = refundable.value.carte > 0 ? "carte" : "virement"
  refundAmount.value = null
  refundQuantities.value = returnable.value.map(() => 0)
  refundShipping.value = false
  refundReason.value = ""
  showRefund.value = true
}
watch(refundKind, (kind) => {
  if (kind === "overpayment") refundChannel.value = "virement"
  refundError.value = ""
  refundSuggestions.value = []
})

// A return's amount is the credit note's: asked of the API as the selection changes.
async function previewReturn() {
  refundPreview.value = null
  const body = refundRequestBody(refundForm())
  if (body.kind !== "goods_return" || (body.lines.length === 0 && !body.includesShipping)) return
  try {
    const { data } = await api<{ data: { amountTtc: number } }>(`/admin/payments/orders/${id}/refunds/preview`, {
      method: "POST",
      body,
    })
    refundPreview.value = data.amountTtc
    refundError.value = ""
  } catch (err) {
    refundError.value = refundFailure(err).message
  }
}
watch([refundKind, refundChannel, refundQuantities, refundShipping], previewReturn, { deep: true })

async function submitRefund() {
  if (refundKind.value !== "goods_return" && (!refundAmount.value || refundAmount.value <= 0)) {
    refundError.value = "Montant invalide."
    return
  }
  refundBusy.value = true
  refundError.value = ""
  refundSuggestions.value = []
  try {
    await api(`/admin/payments/orders/${id}/refunds`, {
      method: "POST",
      body: refundRequestBody(refundForm()),
      headers: { "Idempotency-Key": refundKey },
    })
    refundKey = crypto.randomUUID()
    showRefund.value = false
    await refresh()
  } catch (err) {
    if (!isNetworkFailure(err)) refundKey = crypto.randomUUID()
    const failure = refundFailure(err)
    refundError.value = failure.message
    refundSuggestions.value = failure.suggestions
  } finally {
    refundBusy.value = false
  }
}

// Henrri (story 12.6): put blocked documents back in the queue.
const henrriBusy = ref(false)
const henrriError = ref("")
const canRetryHenrri = computed(
  () => order.value?.henrri.some((document) => document.status === "blocked" || document.held) ?? false,
)

async function retryHenrri() {
  henrriBusy.value = true
  henrriError.value = ""
  try {
    await api(`/admin/orders/${id}/henrri/retry`, { method: "POST" })
    await refresh()
  } catch {
    henrriError.value = "La relance a échoué."
  } finally {
    henrriBusy.value = false
  }
}

function pickSuggestion(amount: number) {
  refundAmount.value = amount
  refundError.value = ""
  refundSuggestions.value = []
}

function num(v: unknown): number | null {
  return v == null ? null : Number(v)
}
</script>

<template>
  <div>
    <NuxtLink to="/admin/orders" class="back">← Commandes</NuxtLink>

    <p v-if="pending" class="state">Chargement…</p>
    <p v-else-if="error || !order" class="state state--error">Commande introuvable.</p>

    <template v-else>
      <header class="head">
        <div>
          <p class="eyebrow">Commande</p>
          <h1>#{{ order.id.slice(0, 8) }}</h1>
          <p class="sub">{{ formatDateTime(order.createdAt) }}</p>
        </div>
        <div class="tags">
          <AdminStatusTag v-bind="paymentStatus(order.paymentStatus)" />
          <AdminStatusTag v-bind="legalStatus(order.legalVerificationStatus)" />
          <AdminStatusTag v-bind="shippingStatus(order.shippingStatus)" />
        </div>
      </header>

      <AdminTabs v-model="activeTab" :tabs="TABS" label="Fiche commande" />

      <div v-if="activeTab === 'history'" id="panel-history" role="tabpanel" aria-labelledby="tab-history">
        <AdminOrderHistory :order-id="order.id" />
      </div>

      <div v-else id="panel-detail" role="tabpanel" aria-labelledby="tab-detail">
      <div class="grid">
        <section class="panel">
          <h2 class="panel__title">Articles</h2>
          <table class="lines">
            <tbody>
              <tr v-for="(it, i) in order.items" :key="i">
                <td>
                  <span class="line-name">{{ it.name }}</span>
                  <span class="line-sku">{{ it.sku }}<template v-if="it.legalCategory && it.legalCategory !== 'none'"> · cat. {{ it.legalCategory }}</template></span>
                </td>
                <td class="num">×{{ it.qty }}</td>
                <td class="num">{{ formatEuros(it.priceHt) }} HT</td>
              </tr>
            </tbody>
          </table>
          <dl class="totals">
            <div><dt>Sous-total HT</dt><dd>{{ formatEuros(order.subtotalHt) }}</dd></div>
            <div v-if="order.vipDiscountAmount > 0"><dt>Remise VIP</dt><dd>−{{ formatEuros(order.vipDiscountAmount) }}</dd></div>
            <div>
              <dt>Livraison HT</dt>
              <dd>{{ formatEuros(order.shippingHt) }} <small>({{ formatEuros(order.shippingCost) }} TTC)</small></dd>
            </div>
            <div><dt>TVA</dt><dd>{{ formatEuros(order.vatAmount) }}</dd></div>
            <div class="totals__grand"><dt>Total TTC</dt><dd>{{ formatEuros(order.totalTtc) }}</dd></div>
          </dl>
        </section>

        <section class="panel">
          <h2 class="panel__title">Client</h2>
          <p class="kv"><span>Email</span>{{ order.user.email }}</p>
          <p class="kv"><span>Nom</span>{{ order.user.firstname }} {{ order.user.lastname }}</p>
          <template v-if="order.shippingAddress">
            <h3 class="sub-h">Livraison</h3>
            <address class="addr">
              {{ order.shippingAddress.firstName }} {{ order.shippingAddress.lastName }}<br />
              {{ order.shippingAddress.line1 }}<br />
              <template v-if="order.shippingAddress.line2">{{ order.shippingAddress.line2 }}<br /></template>
              {{ order.shippingAddress.postal }} {{ order.shippingAddress.city }}
            </address>
          </template>
          <p v-if="order.legalRejectionReason" class="reject">Motif rejet : {{ order.legalRejectionReason }}</p>
        </section>

        <section class="panel">
          <h2 class="panel__title">Paiement</h2>
          <div v-if="order.payment.carte" class="bucket">
            <span class="bucket__label">Carte</span>
            <span class="bucket__amt">{{ formatEuros(num(order.payment.carte.amountTtc)) }}</span>
            <AdminStatusTag v-bind="paymentStatus(String(order.payment.carte.paymentStatus))" />
          </div>
          <div v-if="order.payment.virement" class="bucket">
            <span class="bucket__label">Virement</span>
            <span class="bucket__amt">{{ formatEuros(num(order.payment.virement.amountExpectedTtc)) }}</span>
            <AdminStatusTag v-bind="paymentStatus(String(order.payment.virement.paymentStatus))" />
          </div>
          <p v-if="order.payment.virement?.paymentReference" class="kv">
            <span>Référence</span>{{ order.payment.virement.paymentReference }}
          </p>

          <template v-if="order.payment.refunds.length">
            <h3 class="sub-h">Remboursements</h3>
            <div v-for="r in order.payment.refunds" :key="r.id" class="bucket">
              <span class="bucket__label">{{ r.channel === "carte" ? "Carte" : "Virement" }}</span>
              <span class="bucket__amt">−{{ formatEuros(num(r.amountTtc)) }}</span>
              <AdminStatusTag v-bind="refundStatus(r.status)" />
            </div>
          </template>

          <button v-if="canRefund" type="button" class="btn btn-ghost refund-btn" @click="openRefund">
            Rembourser
          </button>
        </section>

        <section class="panel">
          <h2 class="panel__title">Facturation (Henrri)</h2>
          <p v-if="!order.henrri.length" class="kv">Aucune facture : elle part quand la commande est entièrement payée.</p>
          <div v-for="document in order.henrri" :key="document.id" class="henrri-doc">
            <div class="bucket">
              <span class="bucket__label">{{ henrriDocumentLabel(document) }}</span>
              <span class="bucket__amt">{{ formatEuros(document.amountTtc) }}</span>
              <AdminStatusTag v-bind="henrriDocumentStatus(document.status, document.held)" />
            </div>
            <p v-if="document.lastError" class="henrri-doc__reason">{{ henrriBlockReason(document.lastError) }}</p>
            <p
              v-if="document.kind === 'invoice' && document.status === 'finalized' && !document.paymentRecordedAt"
              class="henrri-doc__reason"
            >
              Règlement pas encore enregistré dans Henrri.
            </p>
          </div>
          <p v-if="henrriError" class="modal__error" role="alert">{{ henrriError }}</p>
          <button
            v-if="canRetryHenrri"
            type="button"
            class="btn btn-ghost refund-btn"
            :disabled="henrriBusy"
            @click="retryHenrri"
          >
            {{ henrriBusy ? "Relance…" : "Relancer la facturation" }}
          </button>
        </section>
      </div>

      <AdminShipmentsPanel :order="order" class="shipping" @changed="refresh" />
      </div>
    </template>

    <!-- Refund modal -->
    <div v-if="showRefund && order" class="modal-scrim" @click.self="showRefund = false">
      <div class="modal" role="dialog" aria-label="Rembourser la commande">
        <h2 class="modal__title">Rembourser</h2>
        <form @submit.prevent="submitRefund">
          <label class="field">
            <span>Nature</span>
            <select v-model="refundKind" class="ctl">
              <option v-for="option in REFUND_KIND_OPTIONS" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>
          <label v-if="refundKind !== 'overpayment'" class="field">
            <span>Canal</span>
            <select v-model="refundChannel" class="ctl">
              <option v-if="refundable.carte > 0" value="carte">Carte (max {{ formatEuros(refundable.carte) }})</option>
              <option v-if="refundable.virement > 0" value="virement">
                Virement (max {{ formatEuros(refundable.virement) }})
              </option>
            </select>
          </label>
          <fieldset v-if="refundKind === 'goods_return'" class="field returns">
            <legend>Articles retournés</legend>
            <label v-for="(item, index) in order.items" :key="index" class="returns__row">
              <span>{{ item.name }}</span>
              <input
                v-model.number="refundQuantities[index]"
                type="number"
                min="0"
                :max="returnable[index]"
                :disabled="returnable[index] === 0"
                class="ctl returns__qty"
                :aria-label="`Quantité retournée — ${item.name}`"
              />
              <span class="returns__max">/ {{ returnable[index] }}</span>
            </label>
            <label class="returns__row">
              <input v-model="refundShipping" type="checkbox" :disabled="deliveryRefunded" />
              <span>Rembourser les frais de port{{ deliveryRefunded ? " (déjà remboursés)" : "" }}</span>
            </label>
            <p class="returns__amount">
              Montant remboursé : <strong>{{ refundPreview === null ? "—" : formatEuros(refundPreview) }}</strong>
            </p>
          </fieldset>
          <label v-else class="field">
            <span>Montant (€)</span>
            <input
              v-model.number="refundAmount"
              type="number"
              step="0.01"
              min="0.01"
              :max="refundable[refundChannel]"
              class="ctl"
            />
          </label>
          <label class="field">
            <span>Motif (optionnel)</span>
            <input v-model="refundReason" type="text" maxlength="255" class="ctl" />
          </label>
          <p v-if="refundError" class="modal__error" role="alert">{{ refundError }}</p>
          <div v-if="refundSuggestions.length" class="modal__suggestions">
            <button
              v-for="amount in refundSuggestions"
              :key="amount"
              type="button"
              class="btn btn-ghost"
              @click="pickSuggestion(amount)"
            >
              {{ formatEuros(amount) }}
            </button>
          </div>
          <div class="modal__actions">
            <button type="submit" class="btn btn-primary" :disabled="refundBusy">
              {{ refundBusy ? "En cours…" : "Confirmer le remboursement" }}
            </button>
            <button type="button" class="btn btn-ghost" :disabled="refundBusy" @click="showRefund = false">
              Annuler
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.back {
  display: inline-block;
  color: var(--paper-dim);
  font-size: var(--fs-sm);
  margin-bottom: 1.2rem;
}
.back:hover {
  color: var(--brass);
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.8rem;
}
.head h1 {
  font-size: var(--fs-2xl);
  margin: 0.2rem 0;
}
.sub {
  color: var(--paper-faint);
  font-size: var(--fs-sm);
  margin: 0;
}
.tags {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.grid {
  display: grid;
  gap: 1.2rem;
  grid-template-columns: 1fr;
}
.panel {
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  padding: 1.3rem 1.4rem;
}
.panel__title {
  font-size: var(--fs-md);
  margin-bottom: 1rem;
}
.lines {
  width: 100%;
  border-collapse: collapse;
}
.lines td {
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--ink-line);
  vertical-align: top;
}
.line-name {
  display: block;
  font-weight: var(--fw-medium);
}
.line-sku {
  display: block;
  font-size: var(--fs-sm);
  color: var(--paper-faint);
}
.num {
  text-align: right;
  white-space: nowrap;
}
.totals {
  margin: 1rem 0 0;
}
.totals div {
  display: flex;
  justify-content: space-between;
  padding: 0.25rem 0;
}
.totals dt {
  color: var(--paper-dim);
  font-size: var(--fs-sm);
}
.totals dd {
  margin: 0;
}
.totals .totals__grand {
  border-top: 1px solid var(--ink-line);
  margin-top: 0.4rem;
  padding-top: 0.6rem;
  font-weight: var(--fw-semibold);
  font-size: var(--fs-md);
}
.kv {
  display: flex;
  gap: 0.6rem;
  margin: 0.35rem 0;
  font-size: var(--fs-base);
}
.kv span {
  color: var(--paper-faint);
  min-width: 84px;
}
.sub-h {
  font-size: var(--fs-md);
  letter-spacing: var(--ls-display);
  color: var(--paper);
  margin: 1.2rem 0 0.6rem;
}
.addr {
  font-style: normal;
  font-size: var(--fs-base);
  line-height: var(--lh-relaxed);
  color: var(--paper-dim);
}
.reject {
  margin-top: 1rem;
  color: var(--danger);
  font-size: var(--fs-sm);
}
.henrri-doc__reason {
  color: var(--paper-faint);
  font-size: var(--fs-sm);
  margin: 0.25rem 0 0.75rem;
}
.bucket {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  padding: 0.55rem 0;
  border-bottom: 1px solid var(--ink-line);
}
.bucket:last-child {
  border-bottom: none;
}
.bucket__label {
  min-width: 70px;
  font-size: var(--fs-sm);
  color: var(--paper-dim);
}
.bucket__amt {
  flex: 1;
  font-weight: var(--fw-semibold);
}
.state {
  color: var(--paper-dim);
  padding: 2rem 0;
}
.state--error {
  color: var(--danger);
}
.shipping {
  margin-top: 1.2rem;
}
.refund-btn {
  margin-top: 1.2rem;
  width: 100%;
  justify-content: center;
}

/* Refund modal */
.modal-scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 1.25rem;
}
.modal {
  width: min(420px, 100%);
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  padding: 1.6rem;
  box-shadow: var(--shadow);
}
.modal__title {
  font-size: var(--fs-lg);
  margin-bottom: 1.2rem;
}
.field {
  display: block;
  margin-bottom: 1rem;
}
.field span {
  display: block;
  font-size: var(--fs-xs);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--paper-faint);
  margin-bottom: 0.4rem;
}
.ctl {
  width: 100%;
  padding: 0.6rem 0.7rem;
  background: var(--ink);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper);
  font-family: inherit;
  font-size: var(--fs-base);
}
.ctl:focus {
  outline: none;
  border-color: var(--brass);
}
.modal__error {
  color: var(--danger);
  font-size: var(--fs-sm);
  margin: 0 0 1rem;
}
.returns {
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  padding: 0.75rem;
}
.returns__row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.35rem 0;
}
.returns__row > span:first-child {
  flex: 1;
}
.returns__qty {
  width: 4.5rem;
}
.returns__max {
  color: var(--paper-faint);
  font-size: var(--fs-sm);
}
.returns__amount {
  margin: 0.75rem 0 0;
}
.modal__suggestions {
  display: flex;
  gap: 0.5rem;
  margin: -0.5rem 0 1rem;
}
.modal__actions {
  display: flex;
  gap: 0.7rem;
  margin-top: 0.5rem;
}

@media (min-width: 860px) {
  .grid {
    grid-template-columns: 1.4fr 1fr;
  }
  .panel:first-child {
    grid-row: span 2;
  }
}
</style>
