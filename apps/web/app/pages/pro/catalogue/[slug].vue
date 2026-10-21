<script setup lang="ts">
import { MAX_QUOTE_LINE_QTY, MAX_QUOTE_LINES } from "@armurier/shared"
import type { ProProductDetail } from "~/types/quote"
import { artworkImage, formatEuros } from "~/utils/format"
import { isRegulated, legalCategoryLabel } from "~/utils/product"

// Story 12.8c — one article of the pro catalogue: choose the variant and the
// quantity, and add it to the request being prepared.
definePageMeta({ middleware: "auth" })

const route = useRoute()
const slug = String(route.params.slug)
const api = useApi()
const access = useProAccess()
const { addToBasket } = useQuotes()

const ready = ref(false)
const product = ref<ProProductDetail | null>(null)
const notFound = ref(false)
const loadError = ref(false)

const variantId = ref<string | null>(null)
const qty = ref(1)
const adding = ref(false)
const added = ref(false)
const addError = ref("")

useHead({ title: () => `${product.value?.name ?? "Article"} — Catalogue professionnel` })

onMounted(async () => {
  await access.load()
  ready.value = true
  if (!access.isApprovedPro.value) return
  try {
    product.value = (await api<{ data: ProProductDetail }>(`/pro/products/slug/${slug}`)).data
    variantId.value = product.value.variants[0]?.id ?? null
  } catch (err) {
    if (authErrorStatus(err) === 404) notFound.value = true
    else loadError.value = true
  }
})

const selected = computed(() => product.value?.variants.find((variant) => variant.id === variantId.value) ?? null)
const netPriceHt = computed(() => selected.value?.netPriceHt ?? product.value?.netPriceHt ?? null)

const variantName = (variant: ProProductDetail["variants"][number]) =>
  [variant.finition, variant.munition, variant.couleur].filter(Boolean).join(" · ") || variant.skuVariant

const ADD_ERRORS: Record<string, string> = {
  QuantityTooLarge: `Une ligne compte ${MAX_QUOTE_LINE_QTY.toLocaleString("fr-FR")} unités au plus.`,
  BasketFull: `Une demande compte ${MAX_QUOTE_LINES} lignes au plus : envoyez celle-ci, puis commencez-en une autre.`,
  NotAvailableForQuote: "Cet article n'est plus proposé.",
}

async function add() {
  if (!variantId.value) return
  adding.value = true
  added.value = false
  addError.value = ""
  try {
    await addToBasket(variantId.value, Number(qty.value))
    added.value = true
  } catch (err) {
    addError.value = ADD_ERRORS[apiErrorCode(err) ?? ""] ?? "Impossible d'ajouter cet article. Réessayez."
  } finally {
    adding.value = false
  }
}
</script>

<template>
  <div class="pro">
    <section class="container pro__inner">
      <AppBreadcrumbs
        :structured="false"
        :items="[{ name: 'Catalogue professionnel', to: '/pro/catalogue' }, { name: product?.name ?? 'Article' }]"
      />

      <p v-if="!ready" class="state">Chargement…</p>
      <ProAccessNotice v-else-if="!access.isApprovedPro.value" :organisation="access.organisation.value" />
      <p v-else-if="notFound" class="state">
        Article introuvable dans le catalogue professionnel.
        <NuxtLink to="/pro/catalogue" class="link">Retour au catalogue</NuxtLink>
      </p>
      <p v-else-if="loadError" class="state">Impossible de charger cet article. Veuillez réessayer.</p>
      <p v-else-if="!product" class="state">Chargement…</p>

      <article v-else class="detail">
        <div class="detail__media">
          <ResponsiveImage
            :image="artworkImage(product.featuredImageUrl, product.slug, 900, 1125)"
            :alt="product.name"
            width="900"
            height="1125"
            loading="eager"
          />
        </div>

        <div class="detail__body">
          <p class="eyebrow">
            {{ product.category.name }}<template v-if="product.audience === 'pro'"> · Réservé pro</template>
          </p>
          <h1 class="detail__title">{{ product.name }}</h1>
          <p class="detail__price">
            {{ netPriceHt === null ? "Prix sur devis" : `${formatEuros(netPriceHt)} HT, votre prix` }}
          </p>
          <p :class="['detail__legal', { 'detail__legal--regulated': isRegulated(product.legalCategory?.category) }]">
            {{ legalCategoryLabel(product.legalCategory?.category) }}
            <template v-if="product.legalCategory?.requiresVerification">
              — le justificatif de votre organisation sera demandé avant la commande.
            </template>
          </p>
          <p v-if="product.description" class="detail__desc">{{ product.description }}</p>

          <form class="pro-add" @submit.prevent="add">
            <fieldset v-if="product.variants.length > 1" class="pro-add__variants">
              <legend>Version</legend>
              <label v-for="variant in product.variants" :key="variant.id" class="pro-add__variant">
                <input v-model="variantId" type="radio" name="variant" :value="variant.id" />
                <span>{{ variantName(variant) }}</span>
              </label>
            </fieldset>
            <label class="pro-add__qty">
              <span>Quantité</span>
              <input v-model.number="qty" name="qty" type="number" min="1" :max="MAX_QUOTE_LINE_QTY" class="ctl" required />
            </label>
            <button type="submit" class="btn btn-primary" :disabled="adding || !variantId">
              {{ adding ? "Ajout…" : "Ajouter à ma demande de devis" }}
            </button>
            <p v-if="added" class="pro-add__ok" role="status">
              Ajouté à votre demande. <NuxtLink to="/pro/demande">Voir ma demande</NuxtLink>
            </p>
            <p v-if="addError" class="pro-add__err" role="alert">{{ addError }}</p>
          </form>
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped>
.pro {
  padding-top: clamp(1.5rem, 4vw, 2.5rem);
}
.pro__inner {
  padding-bottom: 4rem;
}
.state {
  color: var(--paper-dim);
  padding: 1rem 0 3rem;
}
.link {
  color: var(--brass);
}
.detail {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2rem;
  margin-top: 1.5rem;
}
@media (min-width: 820px) {
  .detail {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 3rem;
  }
}
.detail__media {
  aspect-ratio: 4 / 5;
  overflow: hidden;
  border-radius: var(--radius);
  background: var(--ink-soft);
}
.detail__media :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.detail__title {
  font-size: var(--fs-2xl);
  margin: 0.4rem 0 0.6rem;
}
.detail__price {
  font-size: var(--fs-lg);
  color: var(--paper);
  margin: 0 0 0.8rem;
}
.detail__legal {
  color: var(--paper-dim);
  font-size: var(--fs-sm);
  margin: 0 0 1rem;
}
.detail__legal--regulated {
  color: var(--brass);
}
.detail__desc {
  color: var(--paper-dim);
  margin: 0 0 1.5rem;
}
.pro-add {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding-top: 1.2rem;
  border-top: 1px solid var(--ink-line);
}
.pro-add__variants {
  border: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}
.pro-add__variants legend,
.pro-add__qty span {
  display: block;
  font-size: var(--fs-xs);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--paper-faint);
  margin-bottom: 0.4rem;
}
.pro-add__variant {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.8rem;
  border: 1px solid var(--ink-line);
  border-radius: 999px;
  font-size: var(--fs-sm);
  cursor: pointer;
}
.pro-add__variant:has(input:checked) {
  border-color: var(--brass);
  color: var(--brass);
}
.pro-add__qty {
  max-width: 10rem;
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
.pro-add__ok {
  margin: 0;
  color: var(--brass);
}
.pro-add__ok a {
  color: inherit;
  text-decoration: underline;
}
.pro-add__err {
  margin: 0;
  color: var(--danger);
}
</style>
