<script setup lang="ts">
import type { ArtworkThemeDetail } from "~/types/artwork"

const route = useRoute()
const config = useRuntimeConfig()
const apiBase = config.public.apiBase as string
const siteUrl = config.public.siteUrl as string
const slug = route.params.slug as string

const { data, error } = await useFetch<{ data: ArtworkThemeDetail }>(`${apiBase}/artworks/themes/${slug}`, {
  key: `theme-${slug}`,
})

if (error.value || !data.value?.data) {
  throw createError({ statusCode: 404, statusMessage: "Thème introuvable", fatal: true })
}

const theme = computed(() => data.value?.data as ArtworkThemeDetail)
const series = computed(() => theme.value.series)

const pageUrl = `${siteUrl}/collection/theme/${slug}`
const description = computed(
  () => theme.value.description ?? `Les séries Gun Art réunies autour du thème « ${theme.value.name} ».`,
)

useSeoMeta({
  title: () => theme.value.name,
  description,
  ogTitle: () => `${theme.value.name} — SCS Firearm`,
  ogDescription: description,
  ogUrl: pageUrl,
})

useHead({
  link: [{ rel: "canonical", href: pageUrl }],
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
      <nav class="crumbs" aria-label="Fil d'Ariane">
        <NuxtLink to="/collection">Collection</NuxtLink>
        <span aria-hidden="true">/</span>
        <span class="crumbs__current">{{ theme.name }}</span>
      </nav>

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
.crumbs {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--paper-faint);
  margin-bottom: clamp(1.2rem, 4vw, 2rem);
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
.intro__title {
  font-size: clamp(2.4rem, 7vw, 4rem);
  margin: 0.6rem 0 1rem;
}
.intro__lede {
  font-size: clamp(1rem, 2.4vw, 1.15rem);
  color: var(--paper-dim);
  max-width: 60ch;
  margin: 0;
  line-height: 1.7;
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
