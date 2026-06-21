<script setup lang="ts">
import type { ArtworkListItem } from "~/types/artwork"
import { artworkGeometry, artworkImage, availabilityLabel, formatEuros } from "~/utils/format"

const props = defineProps<{
  artwork: ArtworkListItem
  /** LCP optimisation: eager-load the first cards above the fold. */
  priority?: boolean
}>()

const soldOut = computed(() => props.artwork.availableCount <= 0)
const geometry = computed(() => artworkGeometry(props.artwork.orientation))
const img = computed(() =>
  artworkImage(props.artwork.featuredImageUrl, props.artwork.slug, geometry.value.width, geometry.value.height),
)
</script>

<template>
  <article class="card" :class="{ 'is-soldout': soldOut }">
    <NuxtLink :to="`/collection/${artwork.slug}`" class="card__link">
      <div class="card__media" :style="{ aspectRatio: geometry.ratio }">
        <img
          :src="img"
          :alt="`${artwork.title}${artwork.artistName ? ` — ${artwork.artistName}` : ''}`"
          :width="geometry.width"
          :height="geometry.height"
          :loading="priority ? 'eager' : 'lazy'"
          :fetchpriority="priority ? 'high' : 'auto'"
          decoding="async"
        />
        <span class="card__badge badge" :class="soldOut ? 'badge-soldout' : 'badge-available'">
          {{ availabilityLabel(artwork.availableCount, artwork.editionLimit) }}
        </span>
      </div>

      <div class="card__body">
        <p v-if="artwork.artistName" class="eyebrow">{{ artwork.artistName }}</p>
        <h3 class="card__title">{{ artwork.title }}</h3>
        <p class="card__meta">
          Édition limitée · {{ artwork.editionLimit }} exemplaires<span v-if="artwork.editionYear">
            · {{ artwork.editionYear }}</span
          >
        </p>
        <p class="card__price">
          <template v-if="artwork.priceFromTtc !== null">
            <span class="card__from">À partir de</span> {{ formatEuros(artwork.priceFromTtc) }}
            <span class="card__vat">TTC</span>
          </template>
          <template v-else>Édition épuisée</template>
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
  /* aspect-ratio is bound inline from the artwork orientation (portrait /
     landscape / square) so the catalogue mixes ratios without cropping. */
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
.is-soldout .card__media img {
  filter: grayscale(0.5) brightness(0.78);
}
.card__badge {
  position: absolute;
  top: 0.85rem;
  left: 0.85rem;
}
.card__body {
  padding: 1.1rem 0.15rem 0;
}
.card__title {
  font-size: 1.5rem;
  margin: 0.5rem 0 0.35rem;
  transition: color 0.3s var(--ease);
}
.card:hover .card__title {
  color: var(--brass);
}
.card__meta {
  font-size: 0.82rem;
  color: var(--paper-faint);
  margin: 0 0 0.7rem;
}
.card__price {
  font-size: 1rem;
  color: var(--paper);
  margin: 0;
}
.card__from {
  color: var(--paper-dim);
  font-size: 0.82rem;
}
.card__vat {
  color: var(--paper-faint);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
}
</style>
