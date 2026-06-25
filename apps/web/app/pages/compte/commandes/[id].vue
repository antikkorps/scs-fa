<script setup lang="ts">
import type { OrderAddressSnapshot, OrderLegal, OrderLineItem, RequiredDoc } from "~/types/account"
import type { OrderDetail } from "~/types/checkout"
import { formatDate, formatDateTime, formatEuros } from "~/utils/format"
import { needsUpload, requiredDocStatusLabel, requiredDocTone } from "~/utils/legal"
import { legalStatusLabel, paymentStatusLabel, statusTone } from "~/utils/order"

definePageMeta({ middleware: "auth" })
useHead({ title: "Détail de la commande — SCS Firearm" })

const route = useRoute()
const orderId = route.params.id as string
const { get: getOrder } = useOrders()
const { orderLegal, get: getDocument } = useDocuments()

const order = ref<OrderDetail | null>(null)
const legal = ref<OrderLegal | null>(null)
const pending = ref(true)
const notFound = ref(false)
// Which required doc has its upload form expanded.
const openUpload = ref<string | null>(null)
// Short-lived download URLs fetched on demand, keyed by documentId.
const downloads = reactive<Record<string, string>>({})

const items = computed<OrderLineItem[]>(() => (order.value?.items as OrderLineItem[]) ?? [])
const shipping = computed<OrderAddressSnapshot | null>(
  () => (order.value?.shippingAddress as OrderAddressSnapshot) ?? null,
)
const billing = computed<OrderAddressSnapshot | null>(
  () => (order.value?.billingAddress as OrderAddressSnapshot) ?? null,
)

// An order with an outstanding payment still needs the payment flow on the
// confirmation page; surface a link to it rather than duplicating the tunnel.
const paymentOutstanding = computed(
  () => order.value !== null && !["received", "reconciled", "partially_refunded"].includes(order.value.paymentStatus),
)

async function loadOrder() {
  try {
    order.value = await getOrder(orderId)
  } catch (err) {
    if (authErrorStatus(err) === 404) notFound.value = true
    throw err
  }
}

async function loadLegal() {
  try {
    legal.value = await orderLegal(orderId)
  } catch {
    // A 404 here means the order itself is gone — handled by loadOrder.
    legal.value = null
  }
}

async function load() {
  pending.value = true
  try {
    await loadOrder()
    if (!notFound.value) await loadLegal()
  } catch {
    // notFound already set; nothing else to do.
  } finally {
    pending.value = false
  }
}
onMounted(load)

async function onUploaded() {
  openUpload.value = null
  // The upload recomputes the order's legal status server-side; refresh both.
  await Promise.all([loadOrder(), loadLegal()])
}

async function view(doc: RequiredDoc) {
  if (!doc.documentId || downloads[doc.documentId]) {
    if (doc.documentId && downloads[doc.documentId]) window.open(downloads[doc.documentId], "_blank")
    return
  }
  try {
    const full = await getDocument(doc.documentId)
    if (full.downloadUrl) {
      downloads[doc.documentId] = full.downloadUrl
      window.open(full.downloadUrl, "_blank")
    }
  } catch {
    // Silent: the "view" affordance simply does nothing if the file isn't ready.
  }
}

function toggleUpload(docType: string) {
  openUpload.value = openUpload.value === docType ? null : docType
}
</script>

<template>
  <div class="order">
    <section class="container order__inner">
      <p v-if="pending" class="state">Chargement…</p>
      <p v-else-if="notFound" class="state">Commande introuvable.</p>

      <template v-else-if="order">
        <nav class="crumbs" aria-label="Fil d'Ariane">
          <NuxtLink to="/compte" class="link">Mon compte</NuxtLink> <span aria-hidden="true">/</span>
          <NuxtLink to="/compte/commandes" class="link">Mes commandes</NuxtLink> <span aria-hidden="true">/</span>
          {{ order.id.slice(0, 8).toUpperCase() }}
        </nav>

        <header class="order__head">
          <h1 class="order__title">Commande {{ order.id.slice(0, 8).toUpperCase() }}</h1>
          <p class="order__ref">
            Passée le {{ formatDate(order.createdAt) }} · Total {{ formatEuros(order.totalTtc) }} TTC
          </p>
        </header>

        <!-- Status -->
        <section class="status">
          <div>
            <p class="status__label">Statut paiement</p>
            <p class="status__value" :class="`tone-${statusTone(order.paymentStatus)}`">
              {{ paymentStatusLabel(order.paymentStatus) }}
            </p>
          </div>
          <div>
            <p class="status__label">Vérification légale</p>
            <p class="status__value" :class="`tone-${statusTone(order.legalVerificationStatus)}`">
              {{ legalStatusLabel(order.legalVerificationStatus) }}
            </p>
          </div>
        </section>

        <p v-if="paymentOutstanding" class="cta-pay">
          Un règlement est en attente pour cette commande.
          <NuxtLink :to="`/commande/${order.id}`" class="link">Procéder au paiement</NuxtLink>
        </p>

        <!-- Legal checklist -->
        <section v-if="legal?.requiresVerification" class="block" aria-labelledby="legal-h">
          <h2 id="legal-h" class="block__h">Documents légaux</h2>
          <p class="block__lede">
            Les articles réglementés de cette commande nécessitent la vérification des documents ci-dessous. Votre
            commande sera traitée une fois l'ensemble validé.
          </p>

          <p
            v-if="legal.legalVerificationStatus === 'docs_rejected'"
            class="banner banner--neg"
            role="alert"
          >
            Un document a été refusé&nbsp;: {{ rejectionLabel(legal.legalRejectionReason) }}. Merci de le renvoyer.
          </p>
          <p
            v-else-if="['docs_verified', 'completed'].includes(legal.legalVerificationStatus)"
            class="banner banner--pos"
            role="status"
          >
            Tous vos documents ont été validés. Merci&nbsp;!
          </p>

          <ul class="docs" role="list">
            <li v-for="doc in legal.requiredDocs" :key="doc.docType" class="doc">
              <div class="doc__row">
                <div>
                  <p class="doc__name">{{ docTypeLabel(doc.docType) }}</p>
                  <p class="doc__status" :class="`tone-${requiredDocTone(doc.status)}`">
                    {{ requiredDocStatusLabel(doc.status) }}
                    <template v-if="doc.status === 'rejected' && doc.rejectionReason">
                      — {{ rejectionLabel(doc.rejectionReason) }}
                    </template>
                  </p>
                  <p v-if="doc.uploadedAt" class="doc__meta">Envoyé le {{ formatDateTime(doc.uploadedAt) }}</p>
                </div>
                <div class="doc__actions">
                  <button
                    v-if="doc.status === 'approved' && doc.documentId"
                    type="button"
                    class="btn btn-ghost btn-sm"
                    @click="view(doc)"
                  >
                    Voir
                  </button>
                  <button
                    v-if="needsUpload(doc.status)"
                    type="button"
                    class="btn btn-primary btn-sm"
                    @click="toggleUpload(doc.docType)"
                  >
                    {{ openUpload === doc.docType ? "Annuler" : doc.status === "missing" ? "Envoyer" : "Renvoyer" }}
                  </button>
                </div>
              </div>

              <LegalDocUpload v-if="openUpload === doc.docType" :doc-type="doc.docType" @uploaded="onUploaded" />
            </li>
          </ul>
        </section>

        <!-- Items -->
        <section class="block" aria-labelledby="items-h">
          <h2 id="items-h" class="block__h">Articles</h2>
          <ul class="items" role="list">
            <li v-for="(it, i) in items" :key="i" class="item">
              <span class="item__name">{{ it.name }}</span>
              <span class="item__qty">× {{ it.qty }}</span>
              <span class="item__price">{{ formatEuros(it.priceHt * it.qty) }} HT</span>
            </li>
          </ul>
          <dl class="totals">
            <div><dt>Sous-total HT</dt><dd>{{ formatEuros(order.subtotalHt) }}</dd></div>
            <div v-if="order.vipDiscountAmount > 0" class="totals__vip">
              <dt>Remise VIP ({{ order.vipDiscountAppliedPct }}%)</dt>
              <dd>−{{ formatEuros(order.vipDiscountAmount) }}</dd>
            </div>
            <div><dt>TVA</dt><dd>{{ formatEuros(order.vatAmount) }}</dd></div>
            <div class="totals__ttc"><dt>Total TTC</dt><dd>{{ formatEuros(order.totalTtc) }}</dd></div>
          </dl>
        </section>

        <!-- Addresses -->
        <section class="block addresses" aria-labelledby="addr-h">
          <h2 id="addr-h" class="block__h">Livraison &amp; facturation</h2>
          <div class="addr-grid">
            <div v-if="shipping" class="addr">
              <p class="addr__title">Livraison</p>
              <p class="addr__body">
                {{ shipping.firstName }} {{ shipping.lastName }}<br />
                {{ shipping.line1 }}<template v-if="shipping.line2"><br />{{ shipping.line2 }}</template><br />
                {{ shipping.postal }} {{ shipping.city }}<br />
                {{ shipping.country }}
              </p>
            </div>
            <div v-if="billing" class="addr">
              <p class="addr__title">Facturation</p>
              <p class="addr__body">
                {{ billing.firstName }} {{ billing.lastName }}<br />
                {{ billing.line1 }}<template v-if="billing.line2"><br />{{ billing.line2 }}</template><br />
                {{ billing.postal }} {{ billing.city }}<br />
                {{ billing.country }}
              </p>
            </div>
          </div>
        </section>
      </template>
    </section>
  </div>
</template>

<style scoped>
.order {
  padding-top: clamp(1.5rem, 4vw, 2.5rem);
}
.order__inner {
  max-width: 760px;
  padding-bottom: 4rem;
}
.state {
  color: var(--paper-dim);
  padding: 1.5rem 0 4rem;
}
.crumbs {
  font-size: 0.8rem;
  color: var(--paper-dim);
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 0.75rem;
}
.link {
  color: var(--brass);
  text-decoration: underline;
}
.order__head {
  margin-bottom: 1.5rem;
}
.order__title {
  font-size: clamp(1.6rem, 4.5vw, 2.2rem);
  margin: 0 0 0.4rem;
}
.order__ref {
  margin: 0;
  color: var(--paper-dim);
}
.status {
  display: flex;
  gap: 2rem;
  flex-wrap: wrap;
  padding: 1.25rem 0;
  border-block: 1px solid var(--ink-line);
  margin-bottom: 1.25rem;
}
.status__label {
  font-size: 0.7rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--brass);
  margin: 0 0 0.25rem;
}
.status__value {
  margin: 0;
  color: var(--paper);
}
.tone-positive {
  color: var(--brass);
}
.tone-negative {
  color: var(--danger);
}
.tone-neutral {
  color: var(--paper-dim);
}
.cta-pay {
  margin: 0 0 1.5rem;
  padding: 0.9rem 1.1rem;
  font-size: 0.9rem;
  color: var(--paper);
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
}
.block {
  margin-bottom: 1.75rem;
  padding: 1.5rem;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  background: var(--ink-soft);
}
.block__h {
  font-size: 1.15rem;
  margin: 0 0 0.75rem;
}
.block__lede {
  margin: 0 0 1.1rem;
  font-size: 0.9rem;
  color: var(--paper-dim);
}
.banner {
  margin: 0 0 1.1rem;
  padding: 0.7rem 0.9rem;
  font-size: 0.88rem;
  border-radius: var(--radius);
}
.banner--neg {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}
.banner--pos {
  color: var(--brass);
  background: color-mix(in srgb, var(--brass) 12%, transparent);
}
.docs {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.75rem;
}
.doc {
  padding: 1rem;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  background: var(--ink);
}
.doc__row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}
.doc__name {
  margin: 0 0 0.25rem;
  font-weight: 600;
  color: var(--paper);
}
.doc__status {
  margin: 0;
  font-size: 0.85rem;
}
.doc__meta {
  margin: 0.25rem 0 0;
  font-size: 0.78rem;
  color: var(--paper-faint);
}
.doc__actions {
  flex-shrink: 0;
}
.btn-sm {
  height: 38px;
  padding: 0 0.9rem;
  font-size: 0.82rem;
}
.items {
  list-style: none;
  margin: 0 0 1.25rem;
  padding: 0;
  display: grid;
  gap: 0.6rem;
}
.item {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  font-size: 0.92rem;
}
.item__name {
  flex: 1;
  color: var(--paper);
}
.item__qty {
  color: var(--paper-faint);
}
.item__price {
  color: var(--paper-dim);
}
.totals {
  margin: 0;
  display: grid;
  gap: 0.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--ink-line);
}
.totals > div {
  display: flex;
  justify-content: space-between;
  font-size: 0.9rem;
  color: var(--paper-dim);
}
.totals dt,
.totals dd {
  margin: 0;
}
.totals__vip {
  color: var(--brass);
}
.totals__ttc {
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--paper);
}
.addr-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
}
.addr__title {
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--brass);
  margin: 0 0 0.5rem;
}
.addr__body {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.6;
  color: var(--paper);
}
@media (max-width: 560px) {
  .addr-grid {
    grid-template-columns: 1fr;
  }
}
</style>
