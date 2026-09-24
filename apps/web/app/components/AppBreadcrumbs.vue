<script setup lang="ts">
/**
 * The breadcrumb trail, visible and structured in one place (story 9.6).
 *
 * Each page used to hand-write the same `<nav>`, its CSS and — on some pages
 * only — a `BreadcrumbList` whose labels could drift from what the visitor
 * read. Here both come from the same list. The last crumb is the current page:
 * it is not a link, and per Google's guidelines it carries no `item` URL.
 */
const props = withDefaults(
  defineProps<{
    items: { name: string; to?: string }[]
    /** Emit the `BreadcrumbList` — off on pages kept out of the index (account). */
    structured?: boolean
  }>(),
  { structured: true },
)

const siteUrl = useRuntimeConfig().public.siteUrl as string

if (props.structured) {
  useHead({
    script: [
      {
        key: "breadcrumb-jsonld",
        type: "application/ld+json",
        innerHTML: computed(() => serializeJsonLd(breadcrumbJsonLd(siteUrl, props.items))),
      },
    ],
  })
}
</script>

<template>
  <nav class="crumbs" aria-label="Fil d'Ariane">
    <ol class="crumbs__list">
      <li v-for="(item, i) in items" :key="`${i}-${item.name}`" class="crumbs__item">
        <NuxtLink v-if="item.to && i < items.length - 1" :to="item.to">{{ item.name }}</NuxtLink>
        <span v-else class="crumbs__current" aria-current="page">{{ item.name }}</span>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.crumbs {
  font-size: var(--fs-sm);
  letter-spacing: var(--ls-normal);
  color: var(--paper-faint);
  margin-bottom: clamp(1.25rem, 4vw, 2.25rem);
}
.crumbs__list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  list-style: none;
  margin: 0;
  padding: 0;
}
.crumbs__item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
}
.crumbs__item + .crumbs__item::before {
  content: "/";
  color: var(--paper-faint);
}
.crumbs a {
  color: var(--paper-dim);
  text-decoration: none;
}
.crumbs a:hover {
  color: var(--brass);
}
.crumbs__current {
  color: var(--paper);
}
</style>
