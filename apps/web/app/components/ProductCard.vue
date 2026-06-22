<script setup lang="ts">
import type { ProductCardItem } from "~/types/product"
import { artworkImage, CARD_GEOMETRY, formatEuros } from "~/utils/format"
import { inStock, isRegulated, legalCategoryLabel } from "~/utils/product"

const props = defineProps<{
  product: ProductCardItem
  /** LCP optimisation: eager-load the first cards above the fold. */
  priority?: boolean
}>()

const img = computed(() =>
  artworkImage(props.product.featuredImageUrl, props.product.slug, CARD_GEOMETRY.width, CARD_GEOMETRY.height),
)
const available = computed(() => inStock(props.product.stockQty))
const regulated = computed(() => isRegulated(props.product.legalCategory))
</script>

<template>
  <article class="card" :class="{ 'is-out': !available }">
    <NuxtLink :to="`/boutique/${product.slug}`" class="card__link">
      <div class="card__media">
        <img
          :src="img"
          :alt="product.name"
          :width="CARD_GEOMETRY.width"
          :height="CARD_GEOMETRY.height"
          :loading="priority ? 'eager' : 'lazy'"
          :fetchpriority="priority ? 'high' : 'auto'"
          decoding="async"
        />
        <span class="card__badge badge" :class="regulated ? 'badge-legal' : 'badge-free'">
          {{ legalCategoryLabel(product.legalCategory) }}
        </span>
        <span v-if="!available" class="card__badge card__badge--stock badge badge-soldout">Rupture</span>
      </div>

      <div class="card__body">
        <p v-if="product.category.name" class="eyebrow">{{ product.category.name }}</p>
        <h3 class="card__title">{{ product.name }}</h3>
        <p v-if="product.requiresLegalVerification" class="card__legalnote">Contrôle légal requis</p>
        <p class="card__price">
          {{ formatEuros(product.priceTtc) }} <span class="card__vat">TTC</span>
        </p>
      </div>
    </NuxtLink>
  </article>
</template>

<style scoped>
.card__link {
  display: block;
}
.card__media {
  position: relative;
  aspect-ratio: 4 / 5;
  overflow: hidden;
  border-radius: var(--radius);
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
}
.card__media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition:
    transform 0.9s var(--ease),
    filter 0.6s var(--ease);
}
.card:hover .card__media img {
  transform: scale(1.045);
}
.is-out .card__media img {
  filter: grayscale(0.5) brightness(0.78);
}
.card__badge {
  position: absolute;
  top: 0.85rem;
  left: 0.85rem;
}
.card__badge--stock {
  top: auto;
  bottom: 0.85rem;
  left: 0.85rem;
}
.badge-legal {
  color: var(--brass);
  border-color: rgba(200, 163, 91, 0.4);
}
.badge-free {
  color: var(--paper-dim);
}
.card__body {
  padding: 1.1rem 0.15rem 0;
}
.card__title {
  font-size: 1.3rem;
  margin: 0.5rem 0 0.35rem;
  transition: color 0.3s var(--ease);
}
.card:hover .card__title {
  color: var(--brass);
}
.card__legalnote {
  font-size: 0.74rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--paper-faint);
  margin: 0 0 0.6rem;
}
.card__price {
  font-size: 1.1rem;
  color: var(--paper);
  margin: 0;
}
.card__vat {
  color: var(--paper-faint);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
}
</style>
