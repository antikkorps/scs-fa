<script setup lang="ts">
import type { ArtworkThemeDetail } from "~/types/artwork"

const route = useRoute()
const config = useRuntimeConfig()
const siteUrl = config.public.siteUrl as string
const slug = route.params.slug as string

const { data, error } = await useApiFetch<{ data: ArtworkThemeDetail }>(`/artworks/themes/${slug}`, {
  key: `theme-${slug}`,
})

if (error.value || !data.value?.data) {
  throw missingPageError(error.value, "Thème introuvable")
}

const theme = computed(() => data.value?.data as ArtworkThemeDetail)
const series = computed(() => theme.value.series)

const pageUrl = `${siteUrl}/collection/theme/${slug}`
const description = computed(
  () => theme.value.description ?? `Les séries Gun Art réunies autour du thème « ${theme.value.name} ».`,
)

usePageSeo({
  title: () => theme.value.name,
  description,
  path: `/collection/theme/${slug}`,
})

useHead({
  script: [
    {
      type: "application/ld+json",
      innerHTML: computed(() =>
        serializeJsonLd({
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: theme.value.name,
          description: description.value,
          url: pageUrl,
          hasPart: series.value.map((s) => ({
            "@type": "CreativeWorkSeries",
            name: s.title,
            url: `${siteUrl}/collection/serie/${s.slug}`,
          })),
        }),
      ),
    },
  ],
})
</script>

<template>
  <div class="theme">
    <section class="container intro">
      <AppBreadcrumbs :items="[{ name: 'Collection', to: '/collection' }, { name: theme.name }]" />

      <p class="eyebrow">Thème</p>
      <h1 class="intro__title">{{ theme.name }}</h1>
      <p v-if="theme.description" class="intro__lede">{{ theme.description }}</p>
    </section>

    <section class="container">
      <p v-if="series.length === 0" class="state">Aucune série publiée sous ce thème pour l'instant.</p>
      <ul v-else class="serieslist" role="list">
        <li v-for="s in series" :key="s.id">
          <SeriesCard :series="s" />
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.intro {
  padding-top: clamp(1.5rem, 4vw, 2.5rem);
  padding-bottom: clamp(1.75rem, 5vw, 3rem);
  max-width: 760px;
}
.intro__title {
  font-size: var(--fs-3xl);
  margin: 0.6rem 0 1rem;
}
.intro__lede {
  font-size: var(--fs-md);
  color: var(--paper-dim);
  max-width: 60ch;
  margin: 0;
  line-height: var(--lh-relaxed);
}
.serieslist {
  list-style: none;
  margin: 0;
  padding: 0 0 1rem;
  display: grid;
  gap: clamp(1.2rem, 3vw, 2rem);
  grid-template-columns: 1fr;
}
.state {
  color: var(--paper-dim);
  padding: 2rem 0 4rem;
}

@media (min-width: 720px) {
  .serieslist {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
