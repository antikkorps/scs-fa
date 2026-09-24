<script setup lang="ts">
import type { ProductDetail, ProductVariant } from "~/types/product"
import { availabilityLongLabel, availabilityState, isPurchasable } from "~/utils/availability"
import { artworkImage, CARD_GEOMETRY, formatEuros, ogImageUrl } from "~/utils/format"
import { conditionLabel, legalCategoryLabel, legalDocLabel, stockLabel } from "~/utils/product"
import { productJsonLd } from "~/utils/structuredData"

const route = useRoute()
const config = useRuntimeConfig()
const apiBase = config.public.apiBase as string
const siteUrl = config.public.siteUrl as string
const slug = route.params.slug as string

const { data, error } = await useFetch<ProductDetail>(`${apiBase}/products/slug/${slug}`, {
  key: `product-${slug}`,
})

if (error.value || !data.value) {
  throw createError({ statusCode: 404, statusMessage: "Article introuvable", fatal: true })
}

const product = computed(() => data.value as ProductDetail)
const image = computed(() =>
  artworkImage(product.value.featuredImageUrl, product.value.slug, CARD_GEOMETRY.width, CARD_GEOMETRY.height),
)
const legal = computed(() => product.value.legalCategory)

// Collection weapons carry a historical dossier; ordinary products don't.
const ancient = computed(() => product.value.ancientWeapon)
const periodRange = computed(() => {
  const from = ancient.value?.periodStartYear
  const to = ancient.value?.periodEndYear
  if (!from) return null
  return to && to !== from ? `${from}–${to}` : String(from)
})
const historicalEvents = computed(() => [
  ...(ancient.value?.historicalInfo?.battles ?? []),
  ...(ancient.value?.historicalInfo?.events ?? []),
])
const lightboxOpen = ref(false)

// Variants drive price/stock and the cart (the cart adds by variantId).
const variants = computed(() => product.value.variants ?? [])
const selectedVariantId = ref<string | null>(variants.value[0]?.id ?? null)
const selectedVariant = computed(
  () => variants.value.find((v) => v.id === selectedVariantId.value) ?? variants.value[0] ?? null,
)
const variantLabel = (v: ProductVariant) => v.finition ?? v.munition ?? v.couleur ?? v.skuVariant
const hasChoice = computed(() => variants.value.length > 1)
const displayPriceTtc = computed(() => selectedVariant.value?.priceTtc ?? product.value.priceTtc)
// In stock AND not held by another shopper: a unique piece sitting in someone
// else's cart is momentarily unbuyable, and saying so up front is the whole
// point of the hold (story 11.2).
const heldByOther = computed(() => selectedVariant.value?.heldByOther === true)

// Sold vs out of stock (story 11.3). A sold one-off stays online — it keeps its
// editorial and SEO value and shows the house is active — but it is no longer
// purchasable and is marked SoldOut rather than OutOfStock.
const state = computed(() =>
  availabilityState({
    stockQty: selectedVariant.value?.stockQty ?? product.value.stockQty,
    isUnique: product.value.ancientWeapon?.isUnique ?? false,
  }),
)
const isSold = computed(() => state.value === "sold")
const available = computed(() => isPurchasable(state.value) && !heldByOther.value)

const { isAuthenticated } = useAuth()
const cart = useCart()
const adding = ref(false)
const added = ref(false)
const addError = ref("")

async function addToCart() {
  if (!selectedVariant.value) return
  if (!isAuthenticated.value) {
    await navigateTo(`/connexion?redirect=${encodeURIComponent(route.fullPath)}`)
    return
  }
  adding.value = true
  addError.value = ""
  try {
    await cart.addVariant(selectedVariant.value.id, 1)
    added.value = true
  } catch (err) {
    addError.value =
      authErrorStatus(err) === 400 ? "Stock insuffisant pour cette quantité." : "Impossible d'ajouter au panier."
  } finally {
    adding.value = false
  }
}

const pageUrl = `${siteUrl}/boutique/${slug}`
const description = computed(
  () => product.value.seo.metaDescription || product.value.description || `${product.value.name} — SCS Firearm`,
)

// Boutique › category › product: the category is the page a visitor (and a
// crawler) climbs back to.
const crumbs = computed(() => [
  { name: "Boutique", to: "/boutique" },
  ...(product.value.category.slug && product.value.category.name
    ? [{ name: product.value.category.name, to: categoryPath(product.value.category.slug) }]
    : []),
  { name: product.value.name },
])

useSeoMeta({
  title: () => product.value.seo.metaTitle || product.value.name,
  description,
  ogTitle: () => `${product.value.name} — SCS Firearm`,
  ogDescription: description,
  ogType: "website",
  ogUrl: pageUrl,
  ogImage: () => ogImageUrl(product.value?.featuredImageUrl, siteUrl),
})

// What search engines are told is about the PRODUCT, not the variant the
// visitor happens to have selected: it is available if any variant is.
const productState = computed(() =>
  availabilityState({
    stockQty:
      variants.value.length > 0 ? Math.max(...variants.value.map((v) => v.stockQty ?? 0)) : product.value.stockQty,
    isUnique: product.value.ancientWeapon?.isUnique ?? false,
  }),
)
const structuredProduct = computed(() =>
  productJsonLd({
    siteUrl,
    pageUrl,
    name: product.value.name,
    description: description.value,
    sku: product.value.sku,
    image: ogImageUrl(product.value.featuredImageUrl, siteUrl),
    categoryName: product.value.category.name,
    legalCategory: legal.value?.category ?? null,
    state: productState.value,
    // One price per variant, or the product's own when it has none.
    pricesTtc: [
      variants.value[0]?.priceTtc ?? product.value.priceTtc,
      ...variants.value.slice(1).map((v) => v.priceTtc),
    ],
    used: Boolean(product.value.ancientWeapon) || product.value.tags.some((t) => t.slug === "occasion"),
    makerName: product.value.ancientWeapon?.makerName ?? null,
  }),
)

useHead({
  link: [{ rel: "canonical", href: pageUrl }],
  script: [
    {
      type: "application/ld+json",
      innerHTML: computed(() => serializeJsonLd(structuredProduct.value)),
    },
  ],
})
</script>

<template>
  <article class="detail">
    <div class="container">
      <AppBreadcrumbs :items="crumbs" />

      <div class="detail__grid">
        <figure class="detail__media">
          <button
            type="button"
            class="detail__zoom"
            :aria-label="`Agrandir l'image : ${product.name}`"
            @click="lightboxOpen = true"
          >
            <img
              v-img-fallback="image.fallback"
              :src="image.src"
              :alt="product.name"
              :width="CARD_GEOMETRY.width"
              :height="CARD_GEOMETRY.height"
              decoding="async"
            />
            <span class="detail__zoomhint" aria-hidden="true">⤢</span>
          </button>
        </figure>
        <ImageLightbox v-model="lightboxOpen" :src="image.src" :fallback="image.fallback" :alt="product.name" />

        <div class="detail__info">
          <p v-if="product.category.name" class="eyebrow">{{ product.category.name }}</p>
          <h1 class="detail__title">{{ product.name }}</h1>

          <div class="detail__tags">
            <span class="badge" :class="legal && legal.category !== 'none' ? 'badge-legal' : 'badge-free'">
              {{ legalCategoryLabel(legal?.category ?? null) }}
            </span>
            <AvailabilityBadge :state="state" :label="state === 'available' ? stockLabel(product.stockQty) : undefined" />
          </div>

          <p class="detail__price">{{ formatEuros(displayPriceTtc) }} <span>TTC</span></p>

          <p v-if="isSold" class="detail__avail-note">
            Cette pièce a trouvé preneur. Elle reste présentée ici pour mémoire.
          </p>

          <fieldset v-if="hasChoice" class="variants">
            <legend class="variants__legend">Variante</legend>
            <div class="variants__opts">
              <button
                v-for="v in variants"
                :key="v.id"
                type="button"
                class="variants__opt"
                :class="{ 'is-selected': v.id === selectedVariantId, 'is-out': !inStock(v.stockQty) }"
                :aria-pressed="v.id === selectedVariantId"
                @click="selectedVariantId = v.id"
              >
                {{ variantLabel(v) }}
              </button>
            </div>
          </fieldset>

          <p v-if="product.description" class="detail__desc">{{ product.description }}</p>
          <!-- Rich text. Safe to inject because every write path sanitises it
               server-side (apps/api/src/sanitize.ts) — do not render any field
               here that hasn't gone through that. -->
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div v-if="product.longDescription" class="detail__long" v-html="product.longDescription" />

          <!-- Historical dossier: only collection weapons carry one (story 11.2) -->
          <section v-if="ancient" class="hist" aria-labelledby="hist-h">
            <h2 id="hist-h" class="hist__h">L'histoire de cette pièce</h2>
            <dl class="hist__list">
              <div v-if="ancient.period">
                <dt>Époque</dt>
                <dd>{{ ancient.period }}<span v-if="periodRange"> ({{ periodRange }})</span></dd>
              </div>
              <div v-if="ancient.makerName">
                <dt>Fabricant</dt>
                <dd>{{ ancient.makerName }}<span v-if="ancient.makerLocation"> — {{ ancient.makerLocation }}</span></dd>
              </div>
              <div v-if="ancient.provenance">
                <dt>Provenance</dt>
                <dd>{{ ancient.provenance }}</dd>
              </div>
              <div>
                <dt>État</dt>
                <dd>
                  {{ conditionLabel(ancient.condition) }}
                  <span v-if="ancient.conditionDescription"> — {{ ancient.conditionDescription }}</span>
                </dd>
              </div>
              <div v-if="ancient.restorationInfo">
                <dt>Restauration</dt>
                <dd>{{ ancient.restorationInfo }}</dd>
              </div>
              <div v-if="ancient.isAuthentic && ancient.expertName">
                <dt>Expertise</dt>
                <dd>Authentifiée par {{ ancient.expertName }}</dd>
              </div>
              <div v-if="historicalEvents.length > 0">
                <dt>Faits marquants</dt>
                <dd>
                  <ul class="hist__events">
                    <li v-for="e in historicalEvents" :key="e">{{ e }}</li>
                  </ul>
                </dd>
              </div>
              <div v-if="ancient.historicalInfo?.notes">
                <dt>Note</dt>
                <dd>{{ ancient.historicalInfo.notes }}</dd>
              </div>
            </dl>
            <p v-if="ancient.isUnique" class="hist__unique">Pièce unique — un seul exemplaire disponible.</p>
          </section>

          <!-- Legal mentions: the regulated-commerce differentiator -->
          <section v-if="legal" class="legal" aria-labelledby="legal-h">
            <h2 id="legal-h" class="legal__h">Mentions légales</h2>
            <dl class="legal__list">
              <div>
                <dt>Catégorie</dt>
                <dd>{{ legal.name }}<span v-if="legal.description"> — {{ legal.description }}</span></dd>
              </div>
              <div v-if="product.ageMinRequired ?? legal.minAge">
                <dt>Âge minimum</dt>
                <dd>{{ product.ageMinRequired ?? legal.minAge }} ans</dd>
              </div>
              <div v-if="legal.requiredDocTypes.length > 0">
                <dt>Documents requis</dt>
                <dd>
                  <ul class="legal__docs">
                    <li v-for="code in legal.requiredDocTypes" :key="code">{{ legalDocLabel(code) }}</li>
                  </ul>
                </dd>
              </div>
            </dl>
            <p v-if="legal.requiresVerification" class="legal__note">
              La vente est soumise à la vérification de vos documents après la commande.
            </p>
            <p v-if="product.hasAccessoryRestrictions && product.accessoryRestrictionNotes" class="legal__note">
              {{ product.accessoryRestrictionNotes }}
            </p>
          </section>

          <div class="detail__cta">
            <button type="button" class="btn btn-primary buy" :disabled="!available || adding" @click="addToCart">
              {{
                available
                  ? adding
                    ? "Ajout…"
                    : "Ajouter au panier"
                  : heldByOther
                    ? "Momentanément réservée"
                    : availabilityLongLabel(state)
              }}
            </button>
            <p v-if="heldByOther" class="detail__held">
              Un autre client a cette pièce dans son panier. Elle redeviendra disponible s'il ne finalise pas.
            </p>
            <p v-if="added" class="detail__added" role="status">
              Ajouté au panier. <NuxtLink to="/panier">Voir le panier</NuxtLink>
            </p>
            <p v-if="addError" class="detail__error" role="alert">{{ addError }}</p>

            <!-- Story 11.4: an unavailable piece is the moment a visitor most
                 wants to be told about the next one. Pre-ticks the universe this
                 product belongs to, never the whole set. -->
            <NewsletterSignup
              v-if="!available"
              class="detail__news"
              :default-segments="[ancient ? 'collection' : 'armurerie']"
              source="/boutique"
              title="Se tenir informé des arrivées"
              :description="
                isSold
                  ? 'Cette pièce est vendue. Prévenez-moi lorsqu\'une pièce comparable rejoint le catalogue.'
                  : 'Prévenez-moi du retour de cet article et des prochaines arrivées.'
              "
            />
          </div>
        </div>
      </div>

      <!-- Story 11.8 : accessoires suggérés. La liste arrive vide tant que le
           bloc n'est pas activé, et le composant ne rend alors rien. -->
      <ProductCrossSell :items="product.crossSells ?? []" :weapon-name="product.name" />
    </div>
  </article>
</template>

<style scoped>
.detail {
  padding-top: clamp(1.5rem, 4vw, 2.5rem);
}
.detail__grid {
  display: grid;
  gap: clamp(1.75rem, 5vw, 3.5rem);
  grid-template-columns: 1fr;
  align-items: start;
}
.detail__media {
  margin: 0;
  border-radius: var(--radius);
  overflow: hidden;
  border: 1px solid var(--ink-line);
  background: var(--ink-soft);
  box-shadow: var(--shadow);
  aspect-ratio: 4 / 5;
}
.detail__zoom {
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  border: none;
  background: none;
  cursor: zoom-in;
  position: relative;
}
.detail__media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.detail__zoomhint {
  position: absolute;
  bottom: 0.85rem;
  right: 0.85rem;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  font-size: var(--fs-md);
  color: var(--paper);
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid var(--ink-line);
  border-radius: 999px;
  backdrop-filter: blur(4px);
  opacity: 0;
  transition: opacity 0.3s var(--ease);
}
.detail__media:hover .detail__zoomhint,
.detail__zoom:focus-visible .detail__zoomhint {
  opacity: 1;
}
.detail__title {
  font-size: var(--fs-2xl);
  margin: 0.5rem 0 1rem;
}
.detail__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-bottom: 1.25rem;
}
.badge-legal {
  color: var(--brass);
  border-color: rgba(200, 163, 91, 0.4);
}
.badge-free {
  color: var(--paper-dim);
}
.detail__price {
  /* An amount, an edition number or a transfer reference is read, compared
     and copied out: Inter, with lining tabular figures. The display face
     serves oldstyle figures, which are unusable here. */
  font-family: var(--font-body);
  font-variant-numeric: var(--nums);
  font-size: var(--fs-2xl);
  margin: 0 0 1.25rem;
}
.detail__price span {
  font-family: var(--font-body);
  font-size: var(--fs-sm);
  color: var(--paper-faint);
  letter-spacing: var(--ls-wide);
}
.detail__desc {
  font-size: var(--fs-md);
  color: var(--paper);
  margin: 0 0 0.75rem;
}
.detail__long {
  color: var(--paper-dim);
  margin: 0 0 1.5rem;
}
.detail__long :deep(p) {
  margin: 0 0 0.9rem;
}
.detail__long :deep(p:last-child) {
  margin-bottom: 0;
}
.detail__avail-note {
  color: var(--paper-dim);
  font-size: var(--fs-sm);
  margin: 0 0 1.25rem;
}
.detail__news {
  margin-top: 1.75rem;
}
.detail__held {
  color: var(--paper-dim);
  font-size: var(--fs-sm);
  margin: 0.6rem 0 0;
}
.hist {
  border: 1px solid var(--line);
  border-radius: 8px;
  margin: 1.75rem 0;
  padding: 1.5rem;
}
.hist__h {
  font-size: var(--fs-md);
  letter-spacing: var(--ls-display);
  margin: 0 0 1rem;
}
.hist__list {
  display: grid;
  gap: 0.75rem;
  margin: 0;
}
.hist__list > div {
  display: grid;
  gap: 0.15rem;
}
.hist__list dt {
  font-size: var(--fs-xs);
  letter-spacing: var(--ls-wide);
  opacity: 0.6;
  text-transform: uppercase;
}
.hist__list dd {
  margin: 0;
}
.hist__unique {
  color: var(--brass);
  font-size: var(--fs-sm);
  margin: 1rem 0 0;
}
.hist__events {
  list-style: none;
  margin: 0;
  padding: 0;
}
.legal {
  margin: 1.75rem 0;
  padding: 1.5rem;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  background: var(--ink-soft);
}
.legal__h {
  font-size: var(--fs-md);
  margin: 0 0 1rem;
}
.legal__list {
  display: grid;
  gap: 0.9rem;
  margin: 0;
}
.legal__list dt {
  font-size: var(--fs-xs);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--brass);
  margin-bottom: 0.2rem;
}
.legal__list dd {
  margin: 0;
  color: var(--paper);
}
.legal__docs {
  margin: 0;
  padding-left: 1.1rem;
  color: var(--paper-dim);
}
.legal__note {
  margin: 1rem 0 0;
  font-size: var(--fs-sm);
  color: var(--paper-dim);
}
.detail__cta {
  margin-top: 1.75rem;
}
.buy {
  width: 100%;
  justify-content: center;
}
.buy:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.detail__added {
  margin: 0.85rem 0 0;
  font-size: var(--fs-sm);
  color: var(--brass);
}
.detail__added a {
  color: var(--brass);
  text-decoration: underline;
}
.detail__error {
  margin: 0.85rem 0 0;
  font-size: var(--fs-sm);
  color: var(--danger);
}
.variants {
  border: none;
  margin: 0 0 1.5rem;
  padding: 0;
}
.variants__legend {
  font-size: var(--fs-xs);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--brass);
  margin-bottom: 0.6rem;
  padding: 0;
}
.variants__opts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}
.variants__opt {
  padding: 0.55rem 1rem;
  font-size: var(--fs-base);
  color: var(--paper);
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  cursor: pointer;
  transition:
    border-color 0.3s var(--ease),
    color 0.3s var(--ease);
}
.variants__opt:hover {
  border-color: var(--brass);
}
.variants__opt.is-selected {
  border-color: var(--brass);
  color: var(--brass);
}
.variants__opt.is-out {
  opacity: 0.5;
}

@media (min-width: 880px) {
  .detail__grid {
    grid-template-columns: 1fr 1fr;
    gap: 4rem;
  }
  .buy {
    width: auto;
  }
}
</style>
