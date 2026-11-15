<script setup lang="ts">
import type { RouteLocationRaw } from "vue-router"
import { pagerItems } from "~/utils/pagination"

/**
 * Pagination of a listing, as real links (SEO audit 2026-11-15, finding 1): a
 * crawler follows hrefs, never buttons, so every later page stays reachable.
 * Navigation remains client-side through NuxtLink.
 */
const props = defineProps<{
  page: number
  totalPages: number
  /** Where page N lives: the listing's path and query, without `page` for the first one. */
  linkFor: (page: number) => RouteLocationRaw
}>()

const items = computed(() => pagerItems(props.page, props.totalPages))
</script>

<template>
  <nav class="pager" aria-label="Pagination">
    <NuxtLink v-if="page > 1" :to="linkFor(page - 1)" rel="prev" class="pager__step">Précédent</NuxtLink>
    <span v-else class="pager__step" aria-disabled="true">Précédent</span>

    <ol class="pager__pages">
      <li v-for="(item, index) in items" :key="item === 'gap' ? `gap-${index}` : item">
        <span v-if="item === 'gap'" class="pager__gap" aria-hidden="true">…</span>
        <span v-else-if="item === page" class="pager__page is-current" aria-current="page">{{ item }}</span>
        <NuxtLink v-else :to="linkFor(item)" class="pager__page" :aria-label="`Page ${item}`">{{ item }}</NuxtLink>
      </li>
    </ol>

    <NuxtLink v-if="page < totalPages" :to="linkFor(page + 1)" rel="next" class="pager__step">Suivant</NuxtLink>
    <span v-else class="pager__step" aria-disabled="true">Suivant</span>
  </nav>
</template>

<style scoped>
.pager {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 2rem 0 4rem;
}
.pager__pages {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.pager__step,
.pager__page {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.75rem;
  min-height: 2.75rem;
  padding: 0 0.9rem;
  color: var(--paper);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  font-size: var(--fs-sm);
  text-decoration: none;
}
.pager__page {
  padding: 0 0.6rem;
}
a.pager__step:hover,
a.pager__page:hover {
  border-color: var(--brass);
  color: var(--brass);
}
.pager__page.is-current {
  border-color: var(--brass);
  color: var(--brass);
}
.pager__step[aria-disabled="true"] {
  opacity: 0.4;
}
.pager__gap {
  display: inline-flex;
  align-items: center;
  min-height: 2.75rem;
  color: var(--paper-dim);
}
</style>
