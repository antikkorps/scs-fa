<script setup lang="ts">
import type { ProductTag } from "~/types/product"

// The tags of a product, each a link to its own page (/boutique/tag/:slug):
// the way a visitor — and a crawler — finds the other pieces like this one.
defineProps<{ tags: Pick<ProductTag, "slug" | "name">[] }>()
</script>

<template>
  <ul v-if="tags.length > 0" class="ptags" aria-label="Voir aussi">
    <li v-for="tag in tags" :key="tag.slug">
      <NuxtLink :to="tagPath(tag.slug)" class="ptags__link">{{ tag.name }}</NuxtLink>
    </li>
  </ul>
</template>

<style scoped>
.ptags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  list-style: none;
  margin: 0;
  padding: 0;
}
.ptags__link {
  display: inline-block;
  border: 1px solid var(--ink-line);
  border-radius: 999px;
  color: var(--paper-dim);
  font-size: var(--fs-sm);
  line-height: var(--lh-normal);
  padding: 0.25rem 0.8rem;
  text-decoration: none;
}
.ptags__link:hover {
  border-color: var(--brass);
  color: var(--paper);
}
</style>
