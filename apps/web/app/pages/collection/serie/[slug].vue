<script setup lang="ts">
import type { ArtworkSeriesDetail } from "~/types/artwork"
import { artworkImage } from "~/utils/format"

const route = useRoute()
const config = useRuntimeConfig()
const apiBase = config.public.apiBase as string
const siteUrl = config.public.siteUrl as string
const slug = route.params.slug as string

const { data, error } = await useFetch<{ data: ArtworkSeriesDetail }>(`${apiBase}/artworks/series/${slug}`, {
  key: `series-${slug}`,
})

if (error.value || !data.value?.data) {
  throw createError({ statusCode: 404, statusMessage: "Série introuvable", fatal: true })
}

const series = computed(() => data.value?.data as ArtworkSeriesDetail)
const artworks = computed(() => series.value.artworks)

const pageUrl = `${siteUrl}/collection/serie/${slug}`
const description = computed(
  () => series.value.intro ?? `${series.value.title}, série d'éditions limitées de la collection Gun Art.`,
)

useSeoMeta({
  title: () => series.value.title,
  description,
  ogTitle: () => `${series.value.title} — SCS Firearm`,
  ogDescription: description,
  ogType: "article",
  ogUrl: pageUrl,
  ogImage: () =>
    series.value.coverImageUrl ??
    (artworks.value[0] ? artworkImage(artworks.value[0].featuredImageUrl, artworks.value[0].slug) : undefined),
})

useHead({
  link: [{ rel: "canonical", href: pageUrl }],
  script: [
    {
      type: "application/ld+json",
      innerHTML: computed(() =>
        serializeJsonLd({
          "@context": "https://schema.org",
          "@type": "CreativeWorkSeries",
          name: series.value.title,
          description: description.value,
          url: pageUrl,
          ...(series.value.artist && {
            creator: {
              "@type": "Person",
              name: series.value.artist.name,
              url: `${siteUrl}/collection/artiste/${series.value.artist.slug}`,
            },
          }),
          ...(series.value.theme && { genre: series.value.theme.name }),
          hasPart: artworks.value.map((a) => ({
            "@type": "VisualArtwork",
            name: a.title,
            url: `${siteUrl}/collection/${a.slug}`,
          })),
        }),
      ),
    },
    {
      type: "application/ld+json",
      innerHTML: computed(() =>
        serializeJsonLd({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Collection", item: `${siteUrl}/collection` },
            { "@type": "ListItem", position: 2, name: series.value.title, item: pageUrl },
          ],
        }),
      ),
    },
  ],
})
</script>

<template>
  <div class="series">
    <section class="container intro">
      <nav class="crumbs" aria-label="Fil d'Ariane">
        <NuxtLink to="/collection">Collection</NuxtLink>
        <span aria-hidden="true">/</span>
        <span class="crumbs__current">{{ series.title }}</span>
      </nav>

      <p class="eyebrow">Série</p>
      <h1 class="intro__title">{{ series.title }}</h1>

      <p v-if="series.intro" class="intro__lede">{{ series.intro }}</p>

      <dl class="meta">
        <div v-if="series.artist">
          <dt>Artiste</dt>
          <dd><NuxtLink :to="`/collection/artiste/${series.artist.slug}`">{{ series.artist.name }}</NuxtLink></dd>
        </div>
        <div v-if="series.theme">
          <dt>Thème</dt>
          <dd><NuxtLink :to="`/collection/theme/${series.theme.slug}`">{{ series.theme.name }}</NuxtLink></dd>
        </div>
        <div v-if="series.reference">
          <dt>Référence</dt>
          <dd>{{ series.reference }}</dd>
        </div>
      </dl>
    </section>

    <section class="container">
      <p v-if="artworks.length === 0" class="state">Cette série n'a pas encore d'œuvre publiée.</p>
      <ul v-else class="grid" role="list">
        <li v-for="(art, i) in artworks" :key="art.id">
          <ArtworkCard :artwork="art" :priority="i < 2" />
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
  margin: 0 0 1.6rem;
  line-height: 1.7;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 1.6rem;
  margin: 0;
}
.meta dt {
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--paper-faint);
  margin-bottom: 0.25rem;
}
.meta dd {
  margin: 0;
  font-size: 0.95rem;
}
.meta a {
  color: var(--brass);
  text-decoration: none;
}
.meta a:hover {
  text-decoration: underline;
}
.grid {
  list-style: none;
  margin: 0;
  padding: 0 0 1rem;
  display: grid;
  gap: clamp(1.5rem, 4vw, 2.75rem);
  grid-template-columns: 1fr;
}
.state {
  color: var(--paper-dim);
  padding: 2rem 0 4rem;
}

@media (min-width: 560px) {
  .grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (min-width: 960px) {
  .grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
