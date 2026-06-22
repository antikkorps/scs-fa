<script setup lang="ts">
import type { ProductDetail } from "~/types/product"
import { artworkImage, CARD_GEOMETRY, formatEuros } from "~/utils/format"
import { inStock, legalCategoryLabel, legalDocLabel, stockLabel } from "~/utils/product"

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
const available = computed(() => inStock(product.value.stockQty))
const legal = computed(() => product.value.legalCategory)
const lightboxOpen = ref(false)
const added = ref(false)

const pageUrl = `${siteUrl}/boutique/${slug}`
const description = computed(
  () => product.value.seo.metaDescription || product.value.description || `${product.value.name} — SCS Firearm`,
)

useSeoMeta({
  title: () => product.value.seo.metaTitle || product.value.name,
  description,
  ogTitle: () => `${product.value.name} — SCS Firearm`,
  ogDescription: description,
  ogType: "website",
  ogUrl: pageUrl,
  ogImage: image,
})

useHead({
  link: [{ rel: "canonical", href: pageUrl }],
  script: [
    {
      type: "application/ld+json",
      innerHTML: computed(() =>
        serializeJsonLd({
          "@context": "https://schema.org",
          "@type": "Product",
          name: product.value.name,
          description: description.value,
          image: image.value,
          sku: product.value.sku,
          category: product.value.category.name ?? undefined,
          offers: {
            "@type": "Offer",
            priceCurrency: "EUR",
            price: product.value.priceTtc,
            availability: available.value ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
            url: pageUrl,
          },
        }),
      ),
    },
    {
      type: "application/ld+json",
      innerHTML: serializeJsonLd({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Boutique", item: `${siteUrl}/boutique` },
          { "@type": "ListItem", position: 2, name: product.value.name, item: pageUrl },
        ],
      }),
    },
  ],
})
</script>

<template>
  <article class="detail">
    <div class="container">
      <nav class="crumbs" aria-label="Fil d'Ariane">
        <NuxtLink to="/boutique">Boutique</NuxtLink>
        <span aria-hidden="true">/</span>
        <span class="crumbs__current">{{ product.name }}</span>
      </nav>

      <div class="detail__grid">
        <figure class="detail__media">
          <button
            type="button"
            class="detail__zoom"
            :aria-label="`Agrandir l'image : ${product.name}`"
            @click="lightboxOpen = true"
          >
            <img :src="image" :alt="product.name" :width="CARD_GEOMETRY.width" :height="CARD_GEOMETRY.height" decoding="async" />
            <span class="detail__zoomhint" aria-hidden="true">⤢</span>
          </button>
        </figure>
        <ImageLightbox v-model="lightboxOpen" :src="image" :alt="product.name" />

        <div class="detail__info">
          <p v-if="product.category.name" class="eyebrow">{{ product.category.name }}</p>
          <h1 class="detail__title">{{ product.name }}</h1>

          <div class="detail__tags">
            <span class="badge" :class="legal && legal.category !== 'none' ? 'badge-legal' : 'badge-free'">
              {{ legalCategoryLabel(legal?.category ?? null) }}
            </span>
            <span class="badge" :class="available ? 'badge-available' : 'badge-soldout'">
              {{ stockLabel(product.stockQty) }}
            </span>
          </div>

          <p class="detail__price">{{ formatEuros(product.priceTtc) }} <span>TTC</span></p>

          <p v-if="product.description" class="detail__desc">{{ product.description }}</p>
          <p v-if="product.longDescription" class="detail__long">{{ product.longDescription }}</p>

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
            <button type="button" class="btn btn-primary buy" :disabled="!available" @click="added = true">
              {{ available ? "Ajouter au panier" : "Indisponible" }}
            </button>
            <p v-if="added" class="detail__added" role="status">
              Le panier et le tunnel d'achat arrivent à la prochaine étape.
            </p>
          </div>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
.detail {
  padding-top: clamp(1.5rem, 4vw, 2.5rem);
}
.crumbs {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  color: var(--paper-faint);
  text-transform: uppercase;
  margin-bottom: clamp(1.25rem, 4vw, 2.25rem);
}
.crumbs a {
  color: var(--paper-dim);
}
.crumbs a:hover {
  color: var(--brass);
}
.crumbs__current {
  color: var(--paper);
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
  font-size: 1.1rem;
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
  font-size: clamp(2.2rem, 6vw, 3.2rem);
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
  font-family: var(--font-display);
  font-size: 2rem;
  margin: 0 0 1.25rem;
}
.detail__price span {
  font-family: var(--font-body);
  font-size: 0.72rem;
  color: var(--paper-faint);
  letter-spacing: 0.08em;
}
.detail__desc {
  font-size: 1.1rem;
  color: var(--paper);
  margin: 0 0 0.75rem;
}
.detail__long {
  color: var(--paper-dim);
  margin: 0 0 1.5rem;
}
.legal {
  margin: 1.75rem 0;
  padding: 1.5rem;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  background: var(--ink-soft);
}
.legal__h {
  font-size: 1.1rem;
  margin: 0 0 1rem;
}
.legal__list {
  display: grid;
  gap: 0.9rem;
  margin: 0;
}
.legal__list dt {
  font-size: 0.7rem;
  letter-spacing: 0.16em;
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
  font-size: 0.88rem;
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
  font-size: 0.88rem;
  color: var(--brass);
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
