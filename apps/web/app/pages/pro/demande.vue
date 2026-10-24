<script setup lang="ts">
import { MAX_QUOTE_LINE_QTY, MAX_QUOTE_MESSAGE_LENGTH } from "@armurier/shared"
import type { QuoteBasket, QuoteBasketLine } from "~/types/quote"
import { formatEuros } from "~/utils/format"
import { legalCategoryLabel } from "~/utils/product"

// Story 12.8c — the request being prepared: quantities, a message, and off to
// SCS, who answers with a quote.
definePageMeta({ middleware: "auth" })
useHead({ title: "Ma demande de devis — SCS Firearms" })

const access = useProAccess()
const quotes = useQuotes()

const ready = ref(false)
const basket = ref<QuoteBasket | null>(null)
const loadError = ref(false)
const lineError = ref("")
const message = ref("")
const sending = ref(false)
const sendError = ref("")

onMounted(async () => {
  await access.load()
  ready.value = true
  if (!access.isApprovedPro.value) return
  try {
    basket.value = await quotes.fetchBasket()
  } catch {
    loadError.value = true
  }
})

async function changeQty(line: QuoteBasketLine, event: Event) {
  const qty = Number((event.target as HTMLInputElement).value)
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QUOTE_LINE_QTY) {
    lineError.value = `La quantité va de 1 à ${MAX_QUOTE_LINE_QTY.toLocaleString("fr-FR")}.`
    return
  }
  lineError.value = ""
  try {
    basket.value = await quotes.updateLine(line.id, qty)
  } catch {
    lineError.value = "La quantité n'a pas pu être modifiée. Réessayez."
  }
}

async function remove(line: QuoteBasketLine) {
  lineError.value = ""
  try {
    basket.value = await quotes.removeLine(line.id)
  } catch {
    lineError.value = "La ligne n'a pas pu être retirée. Réessayez."
  }
}

async function send() {
  sending.value = true
  sendError.value = ""
  try {
    const request = await quotes.submit(message.value)
    await navigateTo(`/pro/demandes/${request.id}?envoyee=1`)
  } catch (err) {
    const code = apiErrorCode(err)
    if (code === "UnavailableItems") {
      const names = apiErrorField<string[]>(err, "items") ?? []
      sendError.value = `Ces articles ne sont plus proposés, retirez-les puis renvoyez : ${names.join(", ")}.`
    } else if (code === "EmptyBasket") {
      sendError.value = "Votre demande est vide."
    } else if (code === "TooManyQuoteRequests") {
      sendError.value =
        "Vous avez envoyé beaucoup de demandes en peu de temps. Votre sélection est conservée : renvoyez-la dans une heure."
    } else {
      sendError.value = "La demande n'a pas pu être envoyée. Réessayez."
    }
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="pro">
    <section class="container pro__inner">
      <header class="pro__head">
        <p class="eyebrow">Espace professionnel</p>
        <h1 class="pro__title">Ma demande de devis</h1>
      </header>

      <p v-if="!ready" class="state">Chargement…</p>
      <ProAccessNotice v-else-if="!access.isApprovedPro.value" :organisation="access.organisation.value" />
      <p v-else-if="loadError" class="state">Impossible de charger votre demande. Veuillez réessayer.</p>
      <p v-else-if="!basket" class="state">Chargement…</p>
      <p v-else-if="basket.items.length === 0" class="state">
        Votre demande est vide.
        <NuxtLink to="/pro/catalogue" class="link">Parcourir le catalogue professionnel</NuxtLink>
      </p>

      <template v-else>
        <ul class="quote-lines" role="list">
          <li v-for="line in basket.items" :key="line.id" class="quote-line" :class="{ 'is-off': !line.available }">
            <div class="quote-line__main">
              <NuxtLink :to="`/pro/catalogue/${line.product.slug}`" class="quote-line__name">{{ line.product.name }}</NuxtLink>
              <p class="quote-line__meta">
                <template v-if="line.variant.label">{{ line.variant.label }} · </template>{{ line.product.sku }} ·
                {{ legalCategoryLabel(line.product.legalCategory) }}
                <template v-if="line.netPriceHt !== null"> · {{ formatEuros(line.netPriceHt) }} HT l'unité</template>
              </p>
              <p v-if="!line.available" class="quote-line__off">Cet article n'est plus proposé : retirez-le.</p>
            </div>
            <label class="quote-line__qty">
              <span class="sr-only">Quantité de {{ line.product.name }}</span>
              <input
                :name="`qty-${line.id}`"
                type="number"
                min="1"
                :max="MAX_QUOTE_LINE_QTY"
                :value="line.qty"
                class="ctl"
                @change="changeQty(line, $event)"
              />
            </label>
            <button type="button" class="quote-line__remove" :aria-label="`Retirer ${line.product.name}`" @click="remove(line)">
              Retirer
            </button>
          </li>
        </ul>
        <p v-if="lineError" class="err" role="alert">{{ lineError }}</p>

        <form class="quote-send" @submit.prevent="send">
          <label class="field">
            <span>Message pour notre équipe <em>(facultatif)</em></span>
            <textarea
              v-model="message"
              class="ctl"
              rows="4"
              :maxlength="MAX_QUOTE_MESSAGE_LENGTH"
              placeholder="Délai souhaité, lieu de livraison, références de votre marché…"
            />
          </label>
          <p v-if="sendError" class="err" role="alert">{{ sendError }}</p>
          <button type="submit" class="btn btn-primary" :disabled="sending">
            {{ sending ? "Envoi…" : "Envoyer ma demande de devis" }}
          </button>
          <p class="hint">Notre équipe vous répond par un devis envoyé par e-mail.</p>
        </form>
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
.pro__head {
  margin-bottom: 1.75rem;
}
.pro__title {
  font-size: var(--fs-2xl);
  margin: 0.4rem 0 0;
}
.state {
  color: var(--paper-dim);
  padding: 1rem 0 3rem;
}
.link {
  color: var(--brass);
}
.quote-lines {
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
}
.quote-line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 6.5rem auto;
  align-items: center;
  gap: 0.8rem 1rem;
  padding: 1rem 1.2rem;
  border-bottom: 1px solid var(--ink-line);
}
.quote-line:last-child {
  border-bottom: none;
}
@media (max-width: 520px) {
  .quote-line {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .quote-line__main {
    grid-column: 1 / -1;
  }
}
.quote-line.is-off .quote-line__name {
  color: var(--paper-faint);
}
.quote-line__name {
  font-weight: var(--fw-semibold);
  color: var(--paper);
}
.quote-line__meta {
  margin: 0.2rem 0 0;
  font-size: var(--fs-sm);
  color: var(--paper-dim);
}
.quote-line__off {
  margin: 0.3rem 0 0;
  font-size: var(--fs-sm);
  color: var(--danger);
}
.quote-line__remove {
  background: none;
  border: none;
  color: var(--paper-dim);
  font-size: var(--fs-sm);
  text-decoration: underline;
  cursor: pointer;
}
.ctl {
  width: 100%;
  padding: 0.55rem 0.7rem;
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
.quote-send {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  margin-top: 1.5rem;
}
.field span {
  display: block;
  font-size: var(--fs-xs);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--paper-faint);
  margin-bottom: 0.4rem;
}
.quote-send .btn {
  align-self: flex-start;
}
.err {
  color: var(--danger);
  margin: 0;
}
.hint {
  color: var(--paper-faint);
  font-size: var(--fs-sm);
  margin: 0;
}
</style>
