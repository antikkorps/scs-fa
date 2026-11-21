<script setup lang="ts">
const config = useRuntimeConfig()
const siteUrl = config.public.siteUrl as string
const route = useRoute()
const slug = computed(() => String(route.params.slug))

// The category must exist: an unknown slug is a real 404, not an empty grid a
// crawler would index as a thin page.
const { categories, ready, error } = useProductCategories()
// A menu entry showing exactly this category is its canonical page (story 12.15c).
const { categoryPath, ready: menuReady } = useShopMenu()
await Promise.all([ready, menuReady])
const category = computed(() => categories.value.find((c) => c.slug === slug.value))
if (!category.value) {
  throw missingPageError(error.value, "Catégorie introuvable")
}

const name = computed(() => category.value?.name ?? "")
const pageUrl = computed(() => `${siteUrl}${categoryPath(slug.value)}`)
const description = computed(() => categoryMetaDescription(name.value, category.value?.description))

usePageSeo({
  title: () => pagedTitle(`${name.value} — Boutique armurerie`, pageFromQuery(route.query.page)),
  socialTitle: () => `${name.value} — SCS Firearms`,
  description,
  path: () => categoryPath(slug.value),
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
      <p v-if="category?.description" class="intro__lede">{{ category.description }}</p>
    </section>

    <ShopCatalogue
      :key="slug"
      :category="slug"
      :base-path="categoryPath(slug)"
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
