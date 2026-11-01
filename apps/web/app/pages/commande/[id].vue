<script setup lang="ts">
import { orderReference } from "@armurier/shared"
import type { OrderDetail } from "~/types/checkout"
import { formatEuros } from "~/utils/format"
import { legalStatusLabel, paymentDeadlineNote, paymentStatusLabel, statusTone } from "~/utils/order"

definePageMeta({ middleware: "auth" })
useHead({ title: "Votre commande — SCS Firearms" })

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
// Story 12.9a: an order left unpaid past its deadline is cancelled, its items back on sale.
const cancelled = computed(() => order.value?.paymentStatus === "cancelled")
const deadlineNote = computed(() => paymentDeadlineNote(order.value?.paymentDueAt, order.value?.paymentTerms))
// Story 12.8d — a pro order born of a quote: its documents were judged on the quote.
const fromQuote = computed(() => Boolean(order.value?.quoteRequestId))

// The legal-verification status is only worth surfacing once the document
// workflow is actually under way. Before that (e.g. "payment_pending"), it would
// just contradict the payment status, so we lean on the next-step note instead.
const legalShown = computed(() =>
  ["docs_verifying", "docs_verified", "docs_rejected"].includes(order.value?.legalVerificationStatus ?? ""),
)

// A regulated order (UX audit 2026-11-01): documents first, then payment, then
// verification and dispatch — told as numbered steps, before the bank details.
const legalStatus = computed(() => order.value?.legalVerificationStatus ?? "")
const regulated = computed(
  () =>
    !cancelled.value &&
    !fromQuote.value &&
    ["pending", "docs_rejected", "docs_verifying", "docs_verified"].includes(legalStatus.value),
)
const documentsToSend = computed(() => ["pending", "docs_rejected"].includes(legalStatus.value))
const paymentSettled = computed(
  () =>
    cardSettled.value ||
    ["received", "reconciled"].includes(order.value?.paymentStatus ?? "") ||
    virement.value?.status === "transfer_claimed",
)
const stepsLeft = computed(() => Number(documentsToSend.value) + Number(!paymentSettled.value))
const headTitle = computed(() => {
  if (cancelled.value) return "Cette commande n'a pas été réglée"
  if (!regulated.value || stepsLeft.value === 0) return "Merci pour votre commande"
  return stepsLeft.value === 2 ? "Plus que deux étapes" : "Plus qu'une étape"
})

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
          <p class="eyebrow">{{ cancelled ? "Commande annulée" : "Commande enregistrée" }}</p>
          <h1 class="order__title">{{ headTitle }}</h1>
          <p class="order__ref">Référence&nbsp;: {{ orderReference(order.id) }} · Total {{ formatEuros(order.totalTtc) }} TTC</p>
          <p v-if="cancelled" class="order__deadline" role="status">
            Faute de paiement dans le délai prévu, elle a été annulée et ses articles remis en vente. Aucune somme ne vous a
            été prélevée.
          </p>
          <p v-else-if="deadlineNote && !regulated" class="order__deadline">{{ deadlineNote }}</p>
        </header>

        <ol v-if="regulated" class="steps">
          <li class="steps__item" :class="{ 'steps__item--done': !documentsToSend }">
            <h2 class="steps__h">Envoyez vos pièces justificatives</h2>
            <p v-if="legalStatus === 'pending'" class="steps__p">
              La loi les exige pour cette arme. Vous les déposez depuis le détail de votre commande, en quelques minutes.
            </p>
            <p v-else-if="legalStatus === 'docs_rejected'" class="steps__p">
              Une pièce a été refusée : consultez le motif dans le détail de la commande et envoyez-en une nouvelle.
            </p>
            <p v-else-if="legalStatus === 'docs_verifying'" class="steps__p">Pièces reçues, en cours de vérification.</p>
            <p v-else class="steps__p">Pièces validées.</p>
            <NuxtLink v-if="documentsToSend" :to="`/compte/commandes/${order.id}`" class="btn btn-primary steps__cta">
              Envoyer mes documents
            </NuxtLink>
          </li>
          <li class="steps__item" :class="{ 'steps__item--done': paymentSettled }">
            <h2 class="steps__h">Réglez votre commande</h2>
            <p v-if="paymentSettled" class="steps__p">Paiement reçu ou déclaré.</p>
            <p v-else class="steps__p">
              {{ deadlineNote }} Vous pouvez régler dès maintenant : rien n'est expédié avant la validation de vos
              pièces.
            </p>
          </li>
          <li class="steps__item">
            <h2 class="steps__h">Vérification et expédition</h2>
            <p class="steps__p">
              Nous vérifions vos pièces sous 48 heures. Votre commande part dès qu'elles sont validées et le paiement
              reçu ; vous êtes prévenu par e-mail à chaque étape.
            </p>
          </li>
        </ol>

        <!-- Virement bucket -->
        <section v-if="virement && !cancelled" class="pay" aria-labelledby="vir-h">
          <h2 id="vir-h" class="pay__h">Paiement par virement — {{ formatEuros(virement.amountTtc) }}</h2>
          <p class="pay__lede">
            <template v-if="order.paymentTerms === 'net30'">
              Réglez la facture par virement dans les 30 jours suivant l'expédition.
            </template>
            <template v-else>Les armes réglementées se règlent par virement bancaire.</template>
            Indiquez impérativement la référence ci-dessous.
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
        <section v-if="carte && !cancelled" class="pay" aria-labelledby="cb-h">
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

        <p v-if="fromQuote" class="order__next">
          Suivez votre commande depuis
          <NuxtLink :to="`/compte/commandes/${order.id}`" class="link">son détail</NuxtLink>.
        </p>
        <p v-else class="order__next">
          Suivez votre commande depuis
          <NuxtLink :to="`/compte/commandes/${order.id}`" class="link">son détail</NuxtLink>.
          <NuxtLink to="/boutique" class="link">Retour à la boutique</NuxtLink>
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
.steps {
  list-style: none;
  counter-reset: step;
  margin: 0 0 2rem;
  padding: 0;
  display: grid;
  gap: 1rem;
}
.steps__item {
  counter-increment: step;
  position: relative;
  padding: 1.1rem 1.25rem 1.1rem 3.6rem;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  background: var(--ink-soft);
}
.steps__item::before {
  content: counter(step);
  position: absolute;
  left: 1.1rem;
  top: 1.05rem;
  width: 1.75rem;
  height: 1.75rem;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 1px solid var(--brass);
  color: var(--brass);
  font-family: var(--font-body);
  font-variant-numeric: var(--nums);
  font-weight: var(--fw-semibold);
}
.steps__item--done::before {
  content: "✓";
  background: var(--brass);
  color: var(--ink);
}
.steps__h {
  margin: 0 0 0.35rem;
  font-size: var(--fs-md);
}
.steps__p {
  margin: 0;
  color: var(--paper-dim);
  font-size: var(--fs-sm);
}
.steps__cta {
  margin-top: 0.9rem;
}
.order__title {
  font-size: var(--fs-2xl);
  margin: 0.5rem 0 0.75rem;
}
.order__ref {
  color: var(--paper-dim);
  margin: 0;
}
.order__deadline {
  color: var(--brass);
  margin: 0.75rem 0 0;
}
.pay {
  margin-bottom: 1.75rem;
  padding: 1.5rem;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  background: var(--ink-soft);
}
.pay__h {
  font-size: var(--fs-md);
  margin: 0 0 0.6rem;
}
.pay__lede {
  color: var(--paper-dim);
  font-size: var(--fs-base);
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
  font-size: var(--fs-base);
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
  font-weight: var(--fw-semibold);
  /* An amount, an edition number or a transfer reference is read, compared
     and copied out: Inter, with lining tabular figures. The display face
     serves oldstyle figures, which are unusable here. */
  font-family: var(--font-body);
  font-variant-numeric: var(--nums);
  font-size: var(--fs-md);
}
.pay__done {
  color: var(--brass);
  font-size: var(--fs-base);
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
  font-size: var(--fs-xs);
  letter-spacing: var(--ls-eyebrow);
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
  font-size: var(--fs-base);
  line-height: var(--lh-relaxed);
}
</style>
