<script setup lang="ts">
import { CANCELLABLE_QUOTE_STATUSES, CURRENT_TERMS_VERSION, type QuoteRequestStatus } from "@armurier/shared"
import type { Address } from "~/types/checkout"
import type { QuoteRequestDetail } from "~/types/quote"
import { formatDate, formatDateTime, formatEuros } from "~/utils/format"
import { quoteDownloadUrl } from "~/utils/henrri"
import { quoteAcceptanceMessage, quoteRequestStatus } from "~/utils/organisation"
import { legalCategoryLabel } from "~/utils/product"

// Story 12.8c — one quote request: its lines as asked, and its cancellation
// while SCS has not started on it; then (12.8d) the quote SCS sent, its
// prices and its PDF, and its acceptance, which places the order.
definePageMeta({ middleware: "auth" })

const route = useRoute()
const id = String(route.params.id)
const justSent = route.query.envoyee === "1"
const access = useProAccess()
const { getRequest, cancelRequest, acceptQuote } = useQuotes()
const { list: listAddresses } = useAddresses()

const ready = ref(false)
const request = ref<QuoteRequestDetail | null>(null)
const notFound = ref(false)
const loadError = ref(false)
const cancelling = ref(false)
const cancelError = ref("")

useHead({ title: () => `Demande ${request.value?.number ?? ""} — SCS Firearms` })

onMounted(async () => {
  await access.load()
  ready.value = true
  if (!access.isApprovedPro.value) return
  try {
    request.value = await getRequest(id)
  } catch (err) {
    if (authErrorStatus(err) === 404) notFound.value = true
    else loadError.value = true
  }
})

const quote = computed(() => request.value?.quote ?? null)

// Acceptance (story 12.8d-2): where to deliver, the terms, an administration's Chorus Pro references.
const addresses = ref<Address[]>([])
const shippingId = ref("")
const chorusServiceCode = ref("")
const chorusCommitmentNumber = ref("")
const termsAccepted = ref(false)
const termsVersionLabel = formatDate(CURRENT_TERMS_VERSION)
const accepting = ref(false)
const acceptError = ref("")

async function reloadAddresses() {
  addresses.value = await listAddresses()
  if (!shippingId.value) shippingId.value = (addresses.value.find((a) => a.isDefault) ?? addresses.value[0])?.id ?? ""
}

watch(
  () => quote.value?.acceptable,
  (acceptable) => {
    if (acceptable) void reloadAddresses()
  },
)

async function accept() {
  const current = request.value
  if (!current || accepting.value) return
  acceptError.value = ""
  if (!shippingId.value) {
    acceptError.value = "Choisissez une adresse de livraison."
    return
  }
  if (!termsAccepted.value) {
    acceptError.value = "Acceptez les conditions générales de vente pour accepter le devis."
    return
  }
  accepting.value = true
  try {
    const order = await acceptQuote(current.id, {
      shippingAddressId: shippingId.value,
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
      chorusServiceCode: chorusServiceCode.value.trim(),
      chorusCommitmentNumber: chorusCommitmentNumber.value.trim(),
    })
    // The payment page, as after the shop's checkout.
    await navigateTo(`/commande/${order.id}`)
  } catch (err) {
    acceptError.value = quoteAcceptanceMessage(apiErrorCode(err))
    accepting.value = false
  }
}
const quotedLine = (lineId: string) => quote.value?.items.find((item) => item.id === lineId)

const cancellable = computed(() =>
  (CANCELLABLE_QUOTE_STATUSES as readonly QuoteRequestStatus[]).includes(request.value?.status ?? "cancelled"),
)

async function cancel() {
  if (!request.value || !confirm(`Annuler la demande ${request.value.number} ?`)) return
  cancelling.value = true
  cancelError.value = ""
  try {
    request.value = await cancelRequest(request.value.id)
  } catch (err) {
    cancelError.value =
      apiErrorCode(err) === "NotCancellable"
        ? "Notre équipe a déjà commencé à l'étudier : écrivez-nous pour l'arrêter."
        : "L'annulation a échoué. Réessayez."
  } finally {
    cancelling.value = false
  }
}
</script>

<template>
  <div class="pro">
    <section class="container pro__inner">
      <AppBreadcrumbs
        :structured="false"
        :items="[{ name: 'Mes demandes de devis', to: '/pro/demandes' }, { name: request?.number ?? 'Demande' }]"
      />

      <p v-if="!ready" class="state">Chargement…</p>
      <ProAccessNotice v-else-if="!access.isApprovedPro.value" :organisation="access.organisation.value" />
      <p v-else-if="notFound" class="state">Demande introuvable.</p>
      <p v-else-if="loadError" class="state">Impossible de charger cette demande. Veuillez réessayer.</p>
      <p v-else-if="!request" class="state">Chargement…</p>

      <template v-else>
        <p v-if="justSent" class="sent" role="status">
          Demande envoyée. Notre équipe l'étudie et vous envoie un devis par e-mail.
        </p>
        <header class="head">
          <h1 class="pro__title">Demande {{ request.number }}</h1>
          <AdminStatusTag v-bind="quoteRequestStatus(request.status)" />
        </header>
        <p class="meta">Envoyée le {{ formatDateTime(request.createdAt) }}</p>

        <ul class="lines" role="list">
          <li v-for="line in request.items" :key="line.id" class="line">
            <span class="line__main">
              <NuxtLink v-if="line.productSlug" :to="`/pro/catalogue/${line.productSlug}`" class="line__name">
                {{ line.productName }}
              </NuxtLink>
              <span v-else class="line__name">{{ line.productName }}</span>
              <span class="line__meta">
                <template v-if="line.variantLabel">{{ line.variantLabel }} · </template>{{ line.productSku }} ·
                {{ legalCategoryLabel(line.legalCategory) }}
              </span>
            </span>
            <span class="line__qty">
              × {{ line.qty }}
              <span v-if="quotedLine(line.id)" class="line__price">
                {{ formatEuros(quotedLine(line.id)?.unitPriceHt) }} HT l'unité
              </span>
            </span>
          </li>
        </ul>

        <p v-if="request.status === 'in_review'" class="meta">
          Notre équipe prépare votre devis : vous le recevrez par e-mail et le retrouverez ici.
        </p>

        <section v-if="quote" class="quote" aria-labelledby="quote-title">
          <h2 id="quote-title" class="quote__h">Devis {{ quote.number }}</h2>
          <p class="meta">
            Émis le {{ formatDate(quote.issuedAt) }}<template v-if="quote.validUntil">,
              valable jusqu'au {{ formatDate(quote.validUntil) }}</template>.
          </p>
          <dl class="totals">
            <div>
              <dt>Port</dt>
              <dd>{{ quote.shippingTtc > 0 ? `${formatEuros(quote.shippingTtc)} TTC` : "Port offert" }}</dd>
            </div>
            <div><dt>Total HT</dt><dd>{{ formatEuros(quote.totals.totalHt) }}</dd></div>
            <div><dt>TVA</dt><dd>{{ formatEuros(quote.totals.vatAmount) }}</dd></div>
            <div class="totals__ttc"><dt>Total TTC</dt><dd>{{ formatEuros(quote.totals.totalTtc) }}</dd></div>
          </dl>
          <a :href="quoteDownloadUrl(request.id)" class="btn btn-ghost download" download>Télécharger le devis (PDF)</a>

          <div class="accept-block">
            <p v-if="quote.orderId" class="meta">
              Devis accepté. <NuxtLink :to="`/compte/commandes/${quote.orderId}`" class="link">Voir la commande</NuxtLink>
            </p>
            <p v-else-if="quote.refusal" class="notice" role="status">
              {{ quoteAcceptanceMessage(quote.refusal) }}
              <NuxtLink v-if="quote.refusal === 'DocumentsRequired'" to="/pro/documents" class="link">
                Déposer ou consulter les justificatifs
              </NuxtLink>
            </p>
            <template v-else-if="quote.acceptable">
              <h3 class="accept__h">Accepter le devis</h3>
              <p class="meta">
                <template v-if="quote.net30">
                  Paiement à 30 jours : la facture vous est envoyée à l'expédition, à régler par virement dans les 30 jours.
                </template>
                <template v-else>
                  Paiement sous 7 jours après acceptation : par virement pour les armes de catégorie A, B ou C, par
                  carte pour le reste. Sans paiement, la commande est annulée et le devis redevient acceptable tant
                  qu'il est valable.
                </template>
              </p>
              <h4 class="accept__sub">Adresse de livraison</h4>
              <ShippingAddressPicker v-model="shippingId" :addresses="addresses" name="quote-shipping" @created="reloadAddresses" />
              <h4 class="accept__sub">Administrations (facultatif)</h4>
              <p class="hint">Reportés sur la facture pour son dépôt sur Chorus Pro.</p>
              <div class="accept__refs">
                <label class="field">
                  <span>Code service</span>
                  <input v-model="chorusServiceCode" name="chorusServiceCode" class="input" maxlength="100" autocomplete="off" />
                </label>
                <label class="field">
                  <span>Numéro d'engagement</span>
                  <input v-model="chorusCommitmentNumber" name="chorusCommitmentNumber" class="input" maxlength="100" autocomplete="off" />
                </label>
              </div>
              <label class="terms">
                <input v-model="termsAccepted" type="checkbox" name="terms" />
                <span>
                  J'ai lu et j'accepte les
                  <NuxtLink to="/cgv" target="_blank" rel="noopener" class="link">conditions générales de vente</NuxtLink>
                  (version du {{ termsVersionLabel }}).
                </span>
              </label>
              <!-- Art. L221-14 of the Code de la consommation: the button says ordering means paying. -->
              <button type="button" class="btn btn-primary accept" :disabled="accepting" @click="accept">
                {{ accepting ? "Commande en cours…" : "Accepter le devis et commander avec obligation de paiement" }}
              </button>
            </template>
            <p v-if="acceptError" class="err" role="alert">{{ acceptError }}</p>
          </div>
        </section>

        <section v-if="request.message" class="message">
          <h2 class="message__h">Votre message</h2>
          <p>{{ request.message }}</p>
        </section>

        <p v-if="cancelError" class="err" role="alert">{{ cancelError }}</p>
        <button v-if="cancellable" type="button" class="btn btn-ghost cancel" :disabled="cancelling" @click="cancel">
          {{ cancelling ? "Annulation…" : "Annuler cette demande" }}
        </button>
      </template>
    </section>
  </div>
</template>

<style scoped>
.pro {
  padding-top: clamp(1.5rem, 4vw, 2.5rem);
}
.pro__inner {
  max-width: 820px;
  padding-bottom: 4rem;
}
.state {
  color: var(--paper-dim);
  padding: 1rem 0 3rem;
}
.sent {
  padding: 0.9rem 1.1rem;
  border: 1px solid var(--brass);
  border-radius: var(--radius);
  color: var(--brass);
  margin: 1rem 0 1.5rem;
}
.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.8rem;
}
.pro__title {
  font-size: var(--fs-2xl);
  margin: 0.4rem 0;
}
.meta {
  color: var(--paper-dim);
  margin: 0 0 1.5rem;
}
.lines {
  list-style: none;
  margin: 0 0 1.5rem;
  padding: 0;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
}
.line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem 1.2rem;
  border-bottom: 1px solid var(--ink-line);
}
.line:last-child {
  border-bottom: none;
}
.line__name {
  display: block;
  font-weight: var(--fw-semibold);
  color: var(--paper);
}
.line__meta {
  display: block;
  margin-top: 0.2rem;
  font-size: var(--fs-sm);
  color: var(--paper-dim);
}
.line__qty {
  white-space: nowrap;
  font-weight: var(--fw-semibold);
}
.line__price {
  display: block;
  font-weight: var(--fw-regular);
  font-size: var(--fs-sm);
  color: var(--paper-dim);
  text-align: right;
}
.quote {
  margin: 0 0 1.8rem;
  padding: 1.2rem;
  border: 1px solid var(--brass);
  border-radius: var(--radius);
}
.quote__h {
  font-size: var(--fs-lg);
  margin: 0 0 0.3rem;
}
.totals {
  margin: 0 0 1.2rem;
}
.totals div {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--ink-line);
}
.totals dt {
  color: var(--paper-dim);
}
.totals dd {
  margin: 0;
}
.totals__ttc dd {
  font-weight: var(--fw-semibold);
  color: var(--brass);
}
.accept-block {
  margin-top: 1.4rem;
  padding-top: 1.2rem;
  border-top: 1px solid var(--ink-line);
}
.accept__h {
  font-size: var(--fs-lg);
  margin: 0 0 0.4rem;
}
.accept__sub {
  font-size: var(--fs-md);
  margin: 1.2rem 0 0.6rem;
}
.accept__refs {
  display: grid;
  gap: 0.7rem;
  grid-template-columns: 1fr 1fr;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: var(--fs-sm);
  color: var(--paper-dim);
}
.input {
  width: 100%;
  height: 46px;
  padding: 0 0.85rem;
  color: var(--paper);
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  font-family: inherit;
  font-size: var(--fs-base);
}
.input:focus {
  outline: none;
  border-color: var(--brass);
}
.hint {
  margin: 0 0 0.6rem;
  font-size: var(--fs-sm);
  color: var(--paper-dim);
}
.terms {
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
  margin: 1.2rem 0;
  font-size: var(--fs-sm);
  color: var(--paper-dim);
}
.notice {
  margin: 0;
  color: var(--paper-dim);
}
.link {
  color: var(--brass);
}
.accept {
  width: 100%;
  white-space: normal;
}
.message {
  margin-bottom: 1.5rem;
}
.message__h {
  font-size: var(--fs-md);
  margin: 0 0 0.4rem;
}
.message p {
  margin: 0;
  color: var(--paper-dim);
  white-space: pre-line;
}
.err {
  color: var(--danger);
}
</style>
