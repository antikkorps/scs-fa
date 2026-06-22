<script setup lang="ts">
import type { OrderDetail } from "~/types/checkout"
import { formatEuros } from "~/utils/format"
import { legalStatusLabel, paymentStatusLabel, statusTone } from "~/utils/order"

definePageMeta({ middleware: "auth" })
useHead({ title: "Votre commande — SCS Firearm" })

const route = useRoute()
const orderId = route.params.id as string
const { get: getOrder, claimVirement } = useOrders()

const order = ref<OrderDetail | null>(null)
const pending = ref(true)
const notFound = ref(false)
const claiming = ref(false)
const cardPaidLocal = ref(false)

async function load() {
  pending.value = true
  try {
    order.value = await getOrder(orderId)
  } catch (err) {
    if (authErrorStatus(err) === 404) notFound.value = true
  } finally {
    pending.value = false
  }
}
onMounted(load)

// Payment buckets come straight from the order — no blind probing of the
// payment endpoints (avoids spurious 400/409 on card-only or already-paid orders).
const virement = computed(() => order.value?.payment.virement ?? null)
const carte = computed(() => order.value?.payment.carte ?? null)
const carteAmount = computed(() => carte.value?.amountTtc ?? 0)
const cardSettled = computed(() => cardPaidLocal.value || carte.value?.status === "received")
const virementPending = computed(() => virement.value?.status === "awaiting_transfer")

// The legal-verification status is only worth surfacing once the document
// workflow is actually under way. Before that (e.g. "payment_pending"), it would
// just contradict the payment status, so we lean on the next-step note instead.
const legalShown = computed(() =>
  ["docs_verifying", "docs_verified", "docs_rejected"].includes(order.value?.legalVerificationStatus ?? ""),
)

async function onCardPaid() {
  cardPaidLocal.value = true
  // The webhook settles the card bucket asynchronously; poll a few times so the
  // order's status reflects it without a manual reload.
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    try {
      const fresh = await getOrder(orderId)
      order.value = fresh
      if (fresh.payment.carte?.status === "received") break
    } catch {
      // Keep the success message; try again on the next tick.
    }
  }
}

async function declareTransfer() {
  claiming.value = true
  try {
    await claimVirement(orderId)
    order.value = await getOrder(orderId)
  } finally {
    claiming.value = false
  }
}
</script>

<template>
  <div class="order">
    <section class="container order__inner">
      <p v-if="pending" class="state">Chargement…</p>
      <p v-else-if="notFound" class="state">Commande introuvable.</p>

      <template v-else-if="order">
        <header class="order__head">
          <p class="eyebrow">Commande confirmée</p>
          <h1 class="order__title">Merci pour votre commande</h1>
          <p class="order__ref">Référence&nbsp;: {{ order.id.slice(0, 8).toUpperCase() }} · Total {{ formatEuros(order.totalTtc) }} TTC</p>
        </header>

        <!-- Virement bucket -->
        <section v-if="virement" class="pay" aria-labelledby="vir-h">
          <h2 id="vir-h" class="pay__h">Paiement par virement — {{ formatEuros(virement.amountTtc) }}</h2>
          <p class="pay__lede">
            Les armes réglementées se règlent par virement bancaire. Indiquez impérativement la référence ci-dessous.
          </p>
          <dl class="rib">
            <div><dt>Bénéficiaire</dt><dd>{{ virement.accountHolder ?? "—" }}</dd></div>
            <div><dt>IBAN</dt><dd>{{ virement.iban }}</dd></div>
            <div><dt>BIC</dt><dd>{{ virement.bic ?? "—" }}</dd></div>
            <div><dt>Banque</dt><dd>{{ virement.bankName ?? "—" }}</dd></div>
            <div class="rib__ref"><dt>Référence à indiquer</dt><dd>{{ virement.reference }}</dd></div>
          </dl>

          <template v-if="virementPending">
            <button type="button" class="btn btn-primary" :disabled="claiming" @click="declareTransfer">
              {{ claiming ? "Enregistrement…" : "J'ai effectué le virement" }}
            </button>
          </template>
          <p v-else class="pay__done" role="status">
            Virement déclaré — nous le rapprochons à réception. Vous serez notifié.
          </p>
        </section>

        <!-- Carte bucket -->
        <section v-if="carte" class="pay" aria-labelledby="cb-h">
          <h2 id="cb-h" class="pay__h">Paiement par carte — {{ formatEuros(carteAmount) }}</h2>
          <p v-if="cardSettled" class="pay__done" role="status">Paiement par carte reçu. Merci&nbsp;!</p>
          <StripeCardPayment v-else :order-id="orderId" :amount="carteAmount" @paid="onCardPaid" />
        </section>

        <section class="status">
          <div>
            <p class="status__label">Statut paiement</p>
            <p class="status__value" :class="`tone-${statusTone(order.paymentStatus)}`">
              {{ paymentStatusLabel(order.paymentStatus) }}
            </p>
          </div>
          <div v-if="legalShown">
            <p class="status__label">Vérification légale</p>
            <p class="status__value" :class="`tone-${statusTone(order.legalVerificationStatus)}`">
              {{ legalStatusLabel(order.legalVerificationStatus) }}
            </p>
          </div>
        </section>

        <p class="order__next">
          Pour les articles réglementés, l'envoi de vos documents légaux sera demandé depuis votre espace compte
          (prochaine étape). <NuxtLink to="/boutique" class="link">Retour à la boutique</NuxtLink>
        </p>
      </template>
    </section>
  </div>
</template>

<style scoped>
.order {
  padding-top: clamp(1.5rem, 4vw, 2.5rem);
}
.order__inner {
  max-width: 720px;
  padding-bottom: 4rem;
}
.state {
  color: var(--paper-dim);
  padding: 1.5rem 0 4rem;
}
.link {
  color: var(--brass);
  text-decoration: underline;
}
.order__head {
  margin-bottom: 2rem;
}
.order__title {
  font-size: clamp(2rem, 6vw, 3rem);
  margin: 0.5rem 0 0.75rem;
}
.order__ref {
  color: var(--paper-dim);
  margin: 0;
}
.pay {
  margin-bottom: 1.75rem;
  padding: 1.5rem;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  background: var(--ink-soft);
}
.pay__h {
  font-size: 1.15rem;
  margin: 0 0 0.6rem;
}
.pay__lede {
  color: var(--paper-dim);
  font-size: 0.9rem;
  margin: 0 0 1.1rem;
}
.rib {
  margin: 0 0 1.25rem;
  display: grid;
  gap: 0.6rem;
}
.rib > div {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  font-size: 0.92rem;
}
.rib dt {
  color: var(--paper-faint);
}
.rib dd {
  margin: 0;
  text-align: right;
  word-break: break-all;
}
.rib__ref dd {
  color: var(--brass);
  font-weight: 600;
  font-family: var(--font-display);
  font-size: 1.05rem;
}
.pay__done {
  color: var(--brass);
  font-size: 0.9rem;
  margin: 0;
}
.status {
  display: flex;
  gap: 2rem;
  flex-wrap: wrap;
  padding: 1.25rem 0;
  border-block: 1px solid var(--ink-line);
  margin-bottom: 1.5rem;
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
.order__next {
  color: var(--paper-dim);
  font-size: 0.9rem;
  line-height: 1.6;
}
</style>
