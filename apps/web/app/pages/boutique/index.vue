<script setup lang="ts">
const config = useRuntimeConfig()
const siteUrl = config.public.siteUrl as string
const route = useRoute()

// Before story 9.6 a category was a `?category=` filter of this page. It now has
// a page of its own: old links (bookmarks, shares, crawled URLs) are moved there
// for good, the other filters travelling along.
const legacyCategory = route.query.category
if (typeof legacyCategory === "string" && legacyCategory) {
  const { category: _, ...rest } = route.query
  await navigateTo({ path: categoryPath(legacyCategory), query: rest }, { redirectCode: 301 })
}

const pageUrl = `${siteUrl}/boutique`
const description =
  "La boutique armurerie SCS Firearm : armes de chasse et de tir, munitions, optiques et accessoires. Catégories légales, prix TTC et stock en temps réel."

usePageSeo({
  title: "Boutique armurerie",
  description,
  path: "/boutique",
  // ShopCatalogue states the canonical: it knows the page of results.
  canonical: false,
})
</script>

<template>
  <div class="shop">
    <section class="container intro">
      <p class="eyebrow">Armurerie</p>
      <h1 class="intro__title">La boutique</h1>
      <p class="intro__lede">
        Armes de chasse et de tir, munitions, optiques et accessoires. Chaque article indique sa catégorie légale et
        les contrôles requis.
      </p>
    </section>

    <ShopCatalogue category="" base-path="/boutique" list-name="Boutique armurerie SCS Firearm" />
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
