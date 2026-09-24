<script setup lang="ts">
import type { ArtistDetail } from "~/types/artwork"

const route = useRoute()
const config = useRuntimeConfig()
const apiBase = config.public.apiBase as string
const siteUrl = config.public.siteUrl as string
const slug = route.params.slug as string

const { data, error } = await useFetch<{ data: ArtistDetail }>(`${apiBase}/artists/${slug}`, { key: `artist-${slug}` })

if (error.value || !data.value?.data) {
  throw createError({ statusCode: 404, statusMessage: "Artiste introuvable", fatal: true })
}

const artist = computed(() => data.value?.data as ArtistDetail)

const pageUrl = `${siteUrl}/collection/artiste/${slug}`
const description = computed(
  () =>
    artist.value.metaDescription ??
    artist.value.headline ??
    artist.value.bio ??
    `${artist.value.name}, artiste Gun Art.`,
)

useSeoMeta({
  title: () => artist.value.metaTitle ?? artist.value.name,
  description,
  ogTitle: () => `${artist.value.name} — SCS Firearm`,
  ogDescription: description,
  ogType: "profile",
  ogUrl: pageUrl,
  ogImage: () => artist.value.portraitUrl ?? undefined,
})

useHead({
  link: [{ rel: "canonical", href: pageUrl }],
  script: [
    {
      type: "application/ld+json",
      innerHTML: computed(() =>
        serializeJsonLd({
          "@context": "https://schema.org",
          "@type": "Person",
          name: artist.value.name,
          description: artist.value.bio ?? description.value,
          url: pageUrl,
          ...(artist.value.portraitUrl && { image: ogImageUrl(artist.value.portraitUrl, siteUrl) }),
          ...(artist.value.headline && { jobTitle: artist.value.headline }),
          ...(artist.value.series.length > 0 && {
            // The series are the body of work; naming them here is what ties the
            // Person to the CreativeWorkSeries pages.
            subjectOf: artist.value.series.map((s) => ({
              "@type": "CreativeWorkSeries",
              name: s.title,
              url: `${siteUrl}/collection/serie/${s.slug}`,
            })),
          }),
        }),
      ),
    },
  ],
})
</script>

<template>
  <div class="artist">
    <section class="container intro">
      <AppBreadcrumbs :items="[{ name: 'Collection', to: '/collection' }, { name: artist.name }]" />

      <div class="hero" :class="{ 'hero--portrait': artist.portraitUrl }">
        <img
          v-if="artist.portraitUrl"
          :src="artist.portraitUrl"
          :alt="`Portrait de ${artist.name}`"
          class="hero__portrait"
          width="320"
          height="400"
          loading="eager"
        >
        <div class="hero__text">
          <p class="eyebrow">L'artiste</p>
          <h1 class="hero__name">{{ artist.name }}</h1>
          <p v-if="artist.headline" class="hero__headline">{{ artist.headline }}</p>
          <p v-if="artist.bio" class="hero__bio">{{ artist.bio }}</p>

          <!-- Affiliate link: opens in a new tab and is declared as sponsored,
               so the outgoing link never passes ranking signal. -->
          <a
            v-if="artist.book"
            :href="artist.book.url"
            class="btn btn-ghost hero__book"
            target="_blank"
            rel="sponsored noopener"
          >
            Le livre : {{ artist.book.title }}
            <span class="sr-only">(nouvel onglet)</span>
          </a>
        </div>
      </div>

      <section v-if="artist.journey" class="journey" aria-labelledby="journey-h">
        <h2 id="journey-h" class="section__h">Parcours</h2>
        <p class="journey__text">{{ artist.journey }}</p>
      </section>
    </section>

    <section v-if="artist.series.length > 0" class="container block" aria-labelledby="series-h">
      <h2 id="series-h" class="section__h">Ses séries</h2>
      <ul class="serieslist" role="list">
        <li v-for="s in artist.series" :key="s.id">
          <SeriesCard :series="s" />
        </li>
      </ul>
    </section>

    <section v-if="artist.artworks.length > 0" class="container block" aria-labelledby="works-h">
      <h2 id="works-h" class="section__h">Ses œuvres</h2>
      <ul class="grid" role="list">
        <li v-for="(art, i) in artist.artworks" :key="art.id">
          <ArtworkCard :artwork="art" :priority="i < 2" />
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.intro {
  padding-top: clamp(1.5rem, 4vw, 2.5rem);
}
.hero {
  display: grid;
  gap: clamp(1.5rem, 4vw, 3rem);
  grid-template-columns: 1fr;
  align-items: start;
}
.hero__portrait {
  width: 100%;
  max-width: 320px;
  height: auto;
  border-radius: var(--radius);
  border: 1px solid var(--ink-line);
  filter: grayscale(100%);
}
.hero__name {
  font-size: var(--fs-3xl);
  margin: 0.6rem 0 0.6rem;
}
.hero__headline {
  font-size: var(--fs-md);
  color: var(--brass);
  margin: 0 0 1.2rem;
}
.hero__bio {
  color: var(--paper-dim);
  line-height: var(--lh-relaxed);
  max-width: 62ch;
  margin: 0 0 1.6rem;
}
.hero__book {
  text-decoration: none;
}
.journey {
  margin: clamp(2rem, 6vw, 3.5rem) 0 0;
  max-width: 70ch;
}
.section__h {
  font-size: var(--fs-lg);
  letter-spacing: var(--ls-display);
  color: var(--paper);
  margin: 0 0 1rem;
}
.journey__text {
  color: var(--paper-dim);
  line-height: var(--lh-relaxed);
  margin: 0;
}
.block {
  padding-top: clamp(2.5rem, 7vw, 4rem);
}
.serieslist,
.grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: clamp(1.2rem, 3vw, 2rem);
  grid-template-columns: 1fr;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

@media (min-width: 720px) {
  /* Two columns only when there IS a portrait: an empty 320px gutter would
     squeeze the bio into half the page for nothing. */
  .hero--portrait {
    grid-template-columns: 320px minmax(0, 1fr);
  }
  .serieslist {
    grid-template-columns: repeat(2, 1fr);
  }
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
