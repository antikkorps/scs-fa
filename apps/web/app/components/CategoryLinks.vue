<script setup lang="ts">
import type { RouteLocationRaw } from "vue-router"

/**
 * The catalogue's categories as plain links, rendered server-side (SEO audit
 * 2026-11-15, finding 2): the hub page passes its weight to each category page,
 * and a visitor sees the aisles at a glance instead of opening a select.
 */
defineProps<{
  categories: { slug: string; name: string }[]
  /** The page's own category, "" for the whole catalogue, null on a page that is neither (a tag's). */
  current: string | null
  /** Where a category lives ("" = the whole catalogue), with the filters that travel along. */
  linkFor: (slug: string) => RouteLocationRaw
}>()
</script>

<template>
  <nav class="catlinks" aria-label="Catégories">
    <ul role="list">
      <li>
        <NuxtLink :to="linkFor('')" class="catlinks__link" :aria-current="current === '' ? 'page' : undefined">
          Tout le catalogue
        </NuxtLink>
      </li>
      <li v-for="category in categories" :key="category.slug">
        <NuxtLink
          :to="linkFor(category.slug)"
          class="catlinks__link"
          :aria-current="current === category.slug ? 'page' : undefined"
        >
          {{ category.name }}
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.catlinks ul {
  display: flex;
  gap: 0.5rem;
  margin: 0 0 1.25rem;
  /* Room for the focus ring, which the scrolling row would otherwise clip. */
  padding: 0.25rem 0.25rem 0.5rem;
  list-style: none;
  /* One scrollable row on a phone rather than a wall of chips above the products. */
  overflow-x: auto;
  scrollbar-width: thin;
}
.catlinks__link {
  display: inline-flex;
  align-items: center;
  min-height: 2.75rem;
  padding: 0 1rem;
  white-space: nowrap;
  color: var(--paper);
  border: 1px solid var(--ink-line);
  border-radius: 999px;
  font-size: var(--fs-sm);
  text-decoration: none;
}
.catlinks__link:hover,
.catlinks__link[aria-current="page"] {
  border-color: var(--brass);
  color: var(--brass);
}
@media (min-width: 900px) {
  .catlinks ul {
    flex-wrap: wrap;
    overflow-x: visible;
  }
}
</style>
