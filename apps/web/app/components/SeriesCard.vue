<script setup lang="ts">
import type { ArtworkSeriesListItem } from "~/types/artwork"

// `artworkCount` is optional: an artist page lists their series without
// re-counting the works it already shows below.
defineProps<{ series: Omit<ArtworkSeriesListItem, "artworkCount"> & { artworkCount?: number } }>()
</script>

<template>
  <NuxtLink :to="`/collection/serie/${series.slug}`" class="card">
    <p v-if="series.theme" class="card__theme">{{ series.theme.name }}</p>
    <h3 class="card__title">{{ series.title }}</h3>
    <p v-if="series.intro" class="card__intro">{{ series.intro }}</p>
    <p class="card__meta">
      <span v-if="series.reference">{{ series.reference }}</span>
      <span v-if="series.artworkCount !== undefined">
        {{ series.artworkCount }} œuvre<span v-if="series.artworkCount > 1">s</span>
      </span>
    </p>
  </NuxtLink>
</template>

<style scoped>
.card {
  display: block;
  height: 100%;
  padding: 1.3rem 1.4rem;
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: inherit;
  text-decoration: none;
  transition:
    border-color 0.3s var(--ease),
    transform 0.4s var(--ease);
}
.card:hover {
  border-color: var(--brass);
  transform: translateY(-2px);
}
.card__theme {
  margin: 0;
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--paper-faint);
}
.card__title {
  margin: 0.4rem 0 0.6rem;
  font-size: clamp(1.3rem, 3vw, 1.7rem);
}
.card__intro {
  margin: 0 0 1rem;
  color: var(--paper-dim);
  font-size: 0.92rem;
  line-height: 1.65;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 1rem;
  margin: 0;
  font-size: 0.78rem;
  color: var(--paper-faint);
}
</style>
