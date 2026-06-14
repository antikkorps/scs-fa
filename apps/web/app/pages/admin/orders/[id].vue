<script setup lang="ts">
import type { AdminOrderDetail } from "~/types/admin"
import { formatDateTime, formatEuros } from "~/utils/format"
import { legalStatus, paymentStatus, refundStatus } from "~/utils/status"

definePageMeta({ layout: "admin", middleware: "admin" })

const route = useRoute()
const api = useApi()
const id = route.params.id as string

const { data, pending, error } = await useAsyncData(
  `admin-order-${id}`,
  () => api<{ data: AdminOrderDetail }>(`/admin/orders/${id}`),
  { server: false },
)
const order = computed(() => data.value?.data)

useHead({ title: () => `Commande ${id.slice(0, 8)} — Administration SCS` })

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
        </div>
      </header>

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
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.back {
  display: inline-block;
  color: var(--paper-dim);
  font-size: 0.85rem;
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
  font-size: clamp(1.7rem, 5vw, 2.4rem);
  margin: 0.2rem 0;
}
.sub {
  color: var(--paper-faint);
  font-size: 0.85rem;
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
  font-size: 1.05rem;
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
  font-weight: 500;
}
.line-sku {
  display: block;
  font-size: 0.74rem;
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
  font-size: 0.88rem;
}
.totals dd {
  margin: 0;
}
.totals .totals__grand {
  border-top: 1px solid var(--ink-line);
  margin-top: 0.4rem;
  padding-top: 0.6rem;
  font-weight: 600;
  font-size: 1.05rem;
}
.kv {
  display: flex;
  gap: 0.6rem;
  margin: 0.35rem 0;
  font-size: 0.9rem;
}
.kv span {
  color: var(--paper-faint);
  min-width: 84px;
}
.sub-h {
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--paper-faint);
  margin: 1.2rem 0 0.6rem;
}
.addr {
  font-style: normal;
  font-size: 0.9rem;
  line-height: 1.7;
  color: var(--paper-dim);
}
.reject {
  margin-top: 1rem;
  color: var(--danger);
  font-size: 0.85rem;
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
  font-size: 0.85rem;
  color: var(--paper-dim);
}
.bucket__amt {
  flex: 1;
  font-weight: 600;
}
.state {
  color: var(--paper-dim);
  padding: 2rem 0;
}
.state--error {
  color: var(--danger);
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
