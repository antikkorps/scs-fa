<script setup lang="ts">
const route = useRoute()
const slug = computed(() => String(route.params.slug))

// Every published product carrying a tag ("Occasion", "XIXe siècle"…), on a page
// of its own that search engines can list. The tag must exist: an unknown slug
// is a real 404. A tag no product carries any more stays reachable for a link
// someone kept, but out of the indexes: an empty grid is a thin page.
const { facets, ready, error } = useTags()
await ready
const tag = computed(() => facets.value.flatMap((group) => group.tags).find((t) => t.slug === slug.value))
if (!tag.value) {
  throw missingPageError(error.value, "Page introuvable")
}

const name = computed(() => tag.value?.name ?? "")

usePageSeo({
  title: () => `${name.value} — Boutique armurerie`,
  socialTitle: () => `${name.value} — SCS Firearms`,
  description: () => tagMetaDescription(name.value, tag.value?.description),
  path: () => tagPath(slug.value),
  noindex: (tag.value?.productCount ?? 0) === 0,
  // ShopCatalogue states the canonical: it knows the page of results.
  canonical: false,
})
</script>

<template>
  <div class="shop">
    <section class="container intro">
      <AppBreadcrumbs :items="[{ name: 'Boutique', to: '/boutique' }, { name }]" />
      <p class="eyebrow">Armurerie</p>
      <h1 class="intro__title">{{ name }}</h1>
      <p v-if="tag?.description" class="intro__lede">{{ tag.description }}</p>
    </section>

    <ShopCatalogue
      :key="slug"
      category=""
      :tag="slug"
      :base-path="tagPath(slug)"
      :list-name="`${name} — Boutique armurerie SCS Firearms`"
    />
  </div>
</template>

<style scoped>
.intro {
  padding-top: clamp(2.5rem, 7vw, 5rem);
  padding-bottom: clamp(1.5rem, 4vw, 2.5rem);
  max-width: 760px;
}
.intro__title {
  font-size: var(--fs-3xl);
  margin: 0.6rem 0 1rem;
}
.intro__lede {
  font-size: var(--fs-md);
  color: var(--paper-dim);
  max-width: 56ch;
  margin: 0;
}
</style>
